import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Request } from 'express';
import { Router } from 'express';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { findAccessibleCourse, findOwnCourse } from '../lib/access.js';
import { notifyCourseStudents } from '../lib/push.js';
import { enqueueSummary } from '../lib/summaries/pipeline.js';
import { parseTranscriptFile, TRANSCRIPT_EXTENSIONS } from '../lib/summaries/transcript.js';
import { isDate, localNow } from '../lib/time.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { LessonSummary, type LessonSummaryDoc } from '../models/LessonSummary.js';
import { Session } from '../models/Session.js';

/** Mounted at /api: /courses/:id/summaries and /summaries/:summaryId. */
export const summariesRouter = Router();

export const MEDIA_EXTENSIONS = ['.mp4', '.m4a', '.mp3', '.wav', '.webm', '.mov', '.aac', '.ogg', '.mkv'] as const;
const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;

function view(s: LessonSummaryDoc, lecturer: boolean) {
  return {
    id: s.id as string,
    courseId: String(s.courseId),
    sessionId: s.sessionId ? String(s.sessionId) : null,
    date: s.date,
    title: s.title,
    source: s.source,
    sourceName: lecturer ? s.sourceName : '',
    status: s.status,
    progress: s.progress,
    error: lecturer ? s.error : '',
    content: s.content,
    publishedAt: s.publishedAt ?? null,
    createdAt: s.createdAt,
    transcriptSegments: s.transcript?.length ?? 0,
  };
}

/** The course session on that local date (closest to `startsAt`), to link a recording to its lesson. */
async function sessionOn(courseId: mongoose.Types.ObjectId, date: string) {
  const sessions = await Session.find({ courseId }, { startsAt: 1 });
  return sessions.filter((s) => localNow(s.startsAt, config.timeZone).date === date).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0] ?? null;
}

/** Streams the request body to `file`, up to `maxBytes`. */
function saveBody(req: Request, file: string, maxBytes: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const out = createWriteStream(file);
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.unpipe(out);
        out.destroy();
        req.resume();
        reject(Object.assign(new Error('File too large'), { status: 413 }));
      }
    });
    req.pipe(out);
    out.on('finish', () => resolve(bytes));
    out.on('error', reject);
    req.on('error', reject);
  });
}

function readBody(req: Request, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on('data', (c: Buffer) => {
      bytes += c.length;
      if (bytes > maxBytes) reject(Object.assign(new Error('File too large'), { status: 413 }));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Lecturer: all summaries (drafts too). Student: published only, without processing details. Newest lesson first. */
summariesRouter.get('/courses/:id/summaries', requireAuth, async (req, res) => {
  const course = await findAccessibleCourse(String(req.params.id), req.auth!);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const lecturer = req.auth!.role === 'lecturer';
  const list = (await LessonSummary.find(lecturer ? { courseId: course._id } : { courseId: course._id, status: 'published' }, { transcript: 0 }).sort({ date: -1, createdAt: -1 })) as unknown as LessonSummaryDoc[];
  res.json({ course: { id: course.id, name: course.name }, summaries: list.map((s) => view(s, lecturer)) });
});

/**
 * Upload a lesson recording or transcript as the raw request body.
 * Query: fileName (required), date (YYYY-MM-DD, default today), title, sessionId (else matched by date).
 */
summariesRouter.post('/courses/:id/summaries', requireAuth, requireRole('lecturer'), async (req, res) => {
  const course = await findOwnCourse(String(req.params.id), req.auth!.sub);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const fileName = typeof req.query.fileName === 'string' ? path.basename(req.query.fileName).slice(0, 200) : '';
  const ext = path.extname(fileName).toLowerCase();
  const isTranscript = (TRANSCRIPT_EXTENSIONS as readonly string[]).includes(ext);
  const isMedia = (MEDIA_EXTENSIONS as readonly string[]).includes(ext);
  if (!isTranscript && !isMedia) {
    res.status(400).json({ error: 'Unsupported file type', accepted: [...MEDIA_EXTENSIONS, ...TRANSCRIPT_EXTENSIONS] });
    return;
  }
  const date = isDate(req.query.date) ? req.query.date : localNow(new Date(), config.timeZone).date;
  let sessionId: mongoose.Types.ObjectId | undefined;
  if (typeof req.query.sessionId === 'string' && req.query.sessionId) {
    const s = mongoose.isValidObjectId(req.query.sessionId) ? await Session.findOne({ _id: req.query.sessionId, courseId: course._id }, { _id: 1 }) : null;
    if (!s) {
      res.status(400).json({ error: 'Session not found' });
      return;
    }
    sessionId = s._id as mongoose.Types.ObjectId;
  } else {
    sessionId = (await sessionOn(course._id, date))?._id as mongoose.Types.ObjectId | undefined;
  }
  const doc = new LessonSummary({
    courseId: course._id,
    sessionId,
    date,
    title: typeof req.query.title === 'string' ? req.query.title.trim().slice(0, 120) : '',
    source: 'upload',
    sourceName: fileName,
  });

  try {
    if (isTranscript) {
      const segments = parseTranscriptFile(fileName, await readBody(req, MAX_TRANSCRIPT_BYTES));
      if (!segments.length) {
        res.status(400).json({ error: 'The transcript is empty' });
        return;
      }
      doc.set('transcript', segments);
    } else {
      await mkdir(config.mediaDir, { recursive: true });
      const file = path.join(config.mediaDir, `${doc.id}${ext}`);
      try {
        const bytes = await saveBody(req, file, config.maxUploadMb * 1024 * 1024);
        if (bytes === 0) throw Object.assign(new Error('The file is empty'), { status: 400 });
      } catch (e) {
        await rm(file, { force: true });
        throw e;
      }
      doc.mediaPath = file;
    }
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    if (status >= 500) throw e;
    res.status(status).json({ error: (e as Error).message, maxMb: config.maxUploadMb });
    return;
  }
  await doc.save();
  void enqueueSummary(doc.id);
  res.status(201).json({ summary: view(doc, true) });
});

async function findSummary(id: string, auth: { sub: string; role: string }) {
  if (!mongoose.isValidObjectId(id)) return null;
  const summary = await LessonSummary.findById(id);
  if (!summary) return null;
  const course = await findAccessibleCourse(String(summary.courseId), auth);
  if (!course) return null;
  if (auth.role !== 'lecturer' && summary.status !== 'published') return null;
  return { summary, course };
}

/** One summary. The lecturer also gets the transcript. */
summariesRouter.get('/summaries/:summaryId', requireAuth, async (req, res) => {
  const found = await findSummary(String(req.params.summaryId), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Summary not found' });
    return;
  }
  const lecturer = req.auth!.role === 'lecturer';
  res.json({
    course: { id: found.course.id, name: found.course.name },
    summary: view(found.summary, lecturer),
    transcript: lecturer ? found.summary.transcript.map((s) => ({ start: s.start, end: s.end, text: s.text })) : undefined,
  });
});

const strList = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 500)).filter(Boolean).slice(0, max) : null);

/** Lecturer edits: title, date, and the summary text. */
summariesRouter.put('/summaries/:summaryId', requireAuth, requireRole('lecturer'), async (req, res) => {
  const found = await findSummary(String(req.params.summaryId), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Summary not found' });
    return;
  }
  const { summary } = found;
  if (summary.status !== 'draft' && summary.status !== 'published') {
    res.status(409).json({ error: 'Summary is still being processed' });
    return;
  }
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (typeof b.title === 'string') summary.title = b.title.trim().slice(0, 120);
  if (b.date !== undefined) {
    if (!isDate(b.date)) {
      res.status(400).json({ error: 'Invalid date' });
      return;
    }
    summary.date = b.date;
  }
  const c = (b.content ?? null) as Record<string, unknown> | null;
  if (c) {
    if (typeof c.overview === 'string') summary.set('content.overview', c.overview.trim().slice(0, 3000));
    for (const k of ['reminders', 'confusion', 'reviewQuestions'] as const) {
      const v = strList(c[k], 20);
      if (v) summary.set(`content.${k}`, v);
    }
    if (Array.isArray(c.topics))
      summary.set(
        'content.topics',
        c.topics
          .filter((t): t is Record<string, unknown> => !!t && typeof (t as { title?: unknown }).title === 'string')
          .slice(0, 40)
          .map((t) => ({ at: typeof t.at === 'number' ? t.at : null, title: String(t.title).trim().slice(0, 200), points: strList(t.points, 10) ?? [] })),
      );
    if (Array.isArray(c.concepts))
      summary.set(
        'content.concepts',
        c.concepts
          .filter((t): t is Record<string, unknown> => !!t && typeof (t as { term?: unknown }).term === 'string')
          .slice(0, 40)
          .map((t) => ({ term: String(t.term).trim().slice(0, 120), definition: String(t.definition ?? '').trim().slice(0, 500) })),
      );
  }
  await summary.save();
  res.json({ summary: view(summary, true) });
});

/** Publish to students (they get a notification) or take it back to draft. */
summariesRouter.post('/summaries/:summaryId/publish', requireAuth, requireRole('lecturer'), async (req, res) => {
  const found = await findSummary(String(req.params.summaryId), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Summary not found' });
    return;
  }
  const { summary, course } = found;
  const publish = (req.body as { published?: unknown })?.published;
  if (typeof publish !== 'boolean') {
    res.status(400).json({ error: 'Expected { published }' });
    return;
  }
  if (summary.status !== 'draft' && summary.status !== 'published') {
    res.status(409).json({ error: 'Summary is still being processed' });
    return;
  }
  const wasPublished = summary.status === 'published';
  summary.status = publish ? 'published' : 'draft';
  if (publish && !wasPublished) summary.publishedAt = new Date();
  await summary.save();
  if (publish && !wasPublished) {
    notifyCourseStudents(course, {
      title: `סיכום שיעור חדש · ${course.name}`,
      body: summary.title || summary.content?.overview?.slice(0, 120) || 'סיכום השיעור זמין באפליקציה',
      url: `/courses/${course.id}/summaries/${summary.id}`,
      tag: `summary-${summary.id}`,
    });
  }
  res.json({ summary: view(summary, true) });
});

/** Run the summary again (e.g. after a failure or a model change). Keeps the transcript. */
summariesRouter.post('/summaries/:summaryId/retry', requireAuth, requireRole('lecturer'), async (req, res) => {
  const found = await findSummary(String(req.params.summaryId), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Summary not found' });
    return;
  }
  const { summary } = found;
  if (summary.status === 'queued' || summary.status === 'transcribing' || summary.status === 'summarizing') {
    res.status(409).json({ error: 'Summary is still being processed' });
    return;
  }
  if (!summary.mediaPath && summary.transcript.length === 0) {
    res.status(409).json({ error: 'Nothing to summarize: upload the recording again' });
    return;
  }
  summary.set({ status: 'queued', progress: 0, error: '' });
  await summary.save();
  void enqueueSummary(summary.id);
  res.json({ summary: view(summary, true) });
});

summariesRouter.delete('/summaries/:summaryId', requireAuth, requireRole('lecturer'), async (req, res) => {
  const found = await findSummary(String(req.params.summaryId), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Summary not found' });
    return;
  }
  if (found.summary.mediaPath) await rm(found.summary.mediaPath, { force: true });
  await found.summary.deleteOne();
  res.json({ ok: true });
});
