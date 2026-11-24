import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Request } from 'express';
import { Router } from 'express';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { findAccessibleCourse, findOwnCourse } from '../lib/access.js';
import { ExtractError, SUBMISSION_LIMITS, extractSubmission, isCodeSubmission } from '../lib/assignments/extract.js';
import { classOverview, modelFor, reviewSubmission, type Criterion } from '../lib/assignments/review.js';
import { similarPairs } from '../lib/assignments/similarity.js';
import { enqueueJob } from '../lib/jobs.js';
import { notifyCourseStudents, notifyInBackground } from '../lib/push.js';
import { ollamaClient, type LlmClient } from '../lib/summaries/llm.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { Assignment, Submission, type AssignmentDoc, type SubmissionDoc } from '../models/Assignment.js';
import { User } from '../models/User.js';

/** Mounted at /api: /courses/:id/assignments, /assignments/:aid…, /submissions/:sid… */
export const assignmentsRouter = Router();

let llm: LlmClient = ollamaClient;
/** Tests swap in a fake model. */
export function setReviewLlm(client: LlmClient | null) {
  llm = client ?? ollamaClient;
}

/** Students see how the class did on each criterion only once this many others were reviewed (anonymity). */
export const MIN_CLASS_FOR_COMPARISON = 5;

type Auth = { sub: string; role: string };
type CourseLike = { _id: mongoose.Types.ObjectId; id: string; name: string; roster: { email: string; firstName: string; lastName: string }[] };

// ───────────── validation ─────────────

function readCriteria(v: unknown): Criterion[] | { error: string } {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 12) return { error: 'Invalid criteria' };
  const out: Criterion[] = [];
  for (const [i, raw] of v.entries()) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const title = typeof c.title === 'string' ? c.title.trim() : '';
    const points = c.points === undefined ? 0 : Number(c.points);
    if (!title || title.length > 120 || !Number.isFinite(points) || points < 0 || points > 1000) return { error: 'Invalid criteria' };
    out.push({
      id: typeof c.id === 'string' && /^[\w-]{1,24}$/.test(c.id) ? c.id : `c${i + 1}`,
      title,
      description: typeof c.description === 'string' ? c.description.trim().slice(0, 500) : '',
      points,
    });
  }
  if (new Set(out.map((c) => c.id)).size !== out.length) return { error: 'Invalid criteria' };
  return out;
}

function readAssignment(body: unknown, partial = false) {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (!partial || b.title !== undefined) {
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!title || title.length > 150) return { error: 'Title is required' };
    out.title = title;
  }
  if (b.instructions !== undefined) {
    if (typeof b.instructions !== 'string' || b.instructions.length > 10_000) return { error: 'Instructions are too long' };
    out.instructions = b.instructions.trim();
  }
  if (!partial || b.dueAt !== undefined) {
    const due = typeof b.dueAt === 'string' ? new Date(b.dueAt) : null;
    if (!due || Number.isNaN(due.getTime())) return { error: 'Invalid due date' };
    out.dueAt = due;
  }
  if (b.criteria !== undefined) {
    const c = readCriteria(b.criteria);
    if ('error' in c) return c;
    out.criteria = c;
  }
  if (b.maxPoints !== undefined) {
    const m = Number(b.maxPoints);
    if (!Number.isFinite(m) || m <= 0 || m > 1000) return { error: 'Invalid max points' };
    out.maxPoints = m;
  } else if (!partial) {
    const sum = ((out.criteria as Criterion[] | undefined) ?? []).reduce((n, c) => n + c.points, 0);
    out.maxPoints = sum > 0 ? sum : 100;
  }
  if (b.practiceLimit !== undefined) {
    const p = Number(b.practiceLimit);
    if (!Number.isInteger(p) || p < 0 || p > 10) return { error: 'Invalid practice limit' };
    out.practiceLimit = p;
  }
  return out;
}

// ───────────── views ─────────────

const criteriaOf = (a: AssignmentDoc): Criterion[] => a.criteria.map((c) => ({ id: c.id, title: c.title, description: c.description ?? '', points: c.points ?? 0 }));

function assignmentBase(a: AssignmentDoc) {
  return {
    id: a.id as string,
    courseId: String(a.courseId),
    title: a.title,
    instructions: a.instructions,
    dueAt: a.dueAt,
    maxPoints: a.maxPoints,
    criteria: criteriaOf(a),
    practiceLimit: a.practiceLimit,
    status: a.status,
    gradesReleased: a.gradesReleased,
  };
}

function reviewView(s: SubmissionDoc, withPoints: boolean) {
  const r = s.review!;
  return {
    status: r.status,
    error: r.error,
    summary: r.summary,
    strengths: r.strengths,
    improvements: r.improvements,
    criteria: r.criteria.map((c) => ({ criterionId: c.criterionId, met: c.met, feedback: c.feedback, suggestion: c.suggestion, ...(withPoints ? { points: c.points } : {}) })),
    reviewedAt: r.reviewedAt ?? null,
  };
}

function submissionView(s: SubmissionDoc, opts: { lecturer: boolean; gradesReleased: boolean; names?: Map<string, string> }) {
  const showGrade = opts.lecturer || opts.gradesReleased;
  const suggested = s.review?.status === 'done' ? s.review.criteria.reduce((n, c) => n + (c.points ?? 0), 0) : null;
  return {
    id: s.id as string,
    kind: s.kind,
    email: opts.lecturer ? s.email : undefined,
    name: opts.names?.get(s.email) ?? undefined,
    fileName: s.fileName,
    fileSize: s.fileSize,
    files: (s.files ?? []).map((f) => ({ path: f.path, chars: f.text?.length ?? 0, code: !!f.code })), // absent when loaded without contents
    submittedAt: s.submittedAt,
    lateMs: s.lateMs,
    review: reviewView(s, opts.lecturer),
    suggestedPoints: opts.lecturer ? suggested : undefined,
    grade: showGrade && s.grade ? { points: s.grade.points, criteria: s.grade.criteria, comment: s.grade.comment, gradedAt: s.grade.gradedAt } : null,
  };
}

const rosterNames = (course: CourseLike) =>
  new Map(course.roster.map((r) => [r.email.toLowerCase(), `${r.firstName} ${r.lastName}`.trim() || r.email]));

/** Share of other students (reviewed finals) who fully met each criterion; null below the anonymity threshold. */
async function classShares(a: AssignmentDoc, excludeEmail: string) {
  const others = (await Submission.find({ assignmentId: a._id, kind: 'final', 'review.status': 'done', email: { $ne: excludeEmail } }, { 'review.criteria': 1 })) as unknown as SubmissionDoc[];
  if (others.length < MIN_CLASS_FOR_COMPARISON) return null;
  return Object.fromEntries(
    criteriaOf(a).map((c) => {
      const met = others.filter((o) => o.review!.criteria.find((x) => x.criterionId === c.id)?.met === 'yes').length;
      return [c.id, Math.round((met / others.length) * 100)];
    }),
  );
}

// ───────────── access ─────────────

async function findAssignment(id: string, auth: Auth) {
  if (!mongoose.isValidObjectId(id)) return null;
  const assignment = await Assignment.findById(id);
  if (!assignment) return null;
  const course = (await findAccessibleCourse(String(assignment.courseId), auth)) as unknown as CourseLike | null;
  if (!course) return null;
  if (auth.role !== 'lecturer' && assignment.status !== 'published') return null;
  return { assignment, course };
}

async function findSubmission(id: string, auth: Auth) {
  if (!mongoose.isValidObjectId(id)) return null;
  const submission = await Submission.findById(id);
  if (!submission) return null;
  const found = await findAssignment(String(submission.assignmentId), auth);
  if (!found) return null;
  if (auth.role !== 'lecturer' && String(submission.studentId) !== auth.sub) return null;
  return { ...found, submission };
}

// ───────────── review jobs ─────────────

function enqueueReview(submissionId: string) {
  return enqueueJob('review', async () => {
    const s = await Submission.findById(submissionId);
    if (!s || (s.review?.status !== 'queued' && s.review?.status !== 'running')) return;
    const a = await Assignment.findById(s.assignmentId);
    if (!a) return;
    const files = s.files.map((f) => ({ path: f.path ?? '', text: f.text ?? '', code: !!f.code }));
    const code = isCodeSubmission(files);
    s.set({ 'review.status': 'running', 'review.error': '' });
    await s.save();
    try {
      const r = await reviewSubmission({ title: a.title, instructions: a.instructions, criteria: criteriaOf(a) }, files, llm, code);
      s.set({ review: { ...r, status: 'done', error: '', model: modelFor(code), reviewedAt: new Date() } });
      await s.save();
      notifyInBackground([String(s.studentId)], {
        title: s.kind === 'practice' ? `המשוב על הטיוטה מוכן · ${a.title}` : `המשוב על ההגשה מוכן · ${a.title}`,
        body: r.summary.slice(0, 140) || 'אפשר לראות את המשוב באפליקציה',
        url: `/courses/${a.courseId}/assignments/${a.id}`,
        tag: `review-${s.id}`,
      });
    } catch (e) {
      s.set({ 'review.status': 'failed', 'review.error': (e as Error).message.slice(0, 300) });
      await s.save();
    }
  });
}

/** On startup: reviews cut off by a restart are queued again. */
export async function resumeReviewJobs() {
  const stuck = await Submission.find({ 'review.status': { $in: ['queued', 'running'] } }, { _id: 1 });
  for (const s of stuck) void enqueueReview(String(s._id));
  return stuck.length;
}

function readBody(req: Request, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on('data', (c: Buffer) => {
      bytes += c.length;
      if (bytes > maxBytes) {
        req.resume();
        reject(Object.assign(new Error('File too large'), { status: 413 }));
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ───────────── routes: assignments ─────────────

/** Lecturer: all with counts. Student: published, with their own status. Nearest due date first. */
assignmentsRouter.get('/courses/:id/assignments', requireAuth, async (req, res) => {
  const course = await findAccessibleCourse(String(req.params.id), req.auth!);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const lecturer = req.auth!.role === 'lecturer';
  const list = await Assignment.find(lecturer ? { courseId: course._id } : { courseId: course._id, status: 'published' }).sort({ dueAt: 1 });
  const subs = (await Submission.find({ assignmentId: { $in: list.map((a) => a._id) }, kind: 'final' }, { assignmentId: 1, email: 1, studentId: 1, lateMs: 1, 'review.status': 1, grade: 1, submittedAt: 1 })) as unknown as SubmissionDoc[];
  const me = req.auth!.sub;
  res.json({
    course: { id: course.id, name: course.name },
    assignments: list.map((a) => {
      const finals = subs.filter((s) => String(s.assignmentId) === String(a._id));
      if (lecturer)
        return {
          ...assignmentBase(a),
          counts: {
            roster: course.roster.length,
            submitted: finals.length,
            late: finals.filter((s) => s.lateMs > 0).length,
            reviewed: finals.filter((s) => s.review?.status === 'done').length,
            graded: finals.filter((s) => s.grade).length,
          },
        };
      const mine = finals.find((s) => String(s.studentId) === me);
      return {
        ...assignmentBase(a),
        mine: mine ? { submittedAt: mine.submittedAt, lateMs: mine.lateMs, reviewStatus: mine.review?.status, grade: a.gradesReleased && mine.grade ? mine.grade.points : null } : null,
      };
    }),
  });
});

assignmentsRouter.post('/courses/:id/assignments', requireAuth, requireRole('lecturer'), async (req, res) => {
  const course = await findOwnCourse(String(req.params.id), req.auth!.sub);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const input = readAssignment(req.body);
  if ('error' in input) {
    res.status(400).json(input);
    return;
  }
  const a = await Assignment.create({ courseId: course._id, ...input });
  if ((req.body as { publish?: unknown })?.publish === true) await publish(a, course as unknown as CourseLike);
  res.status(201).json({ assignment: assignmentBase(a) });
});

async function publish(a: AssignmentDoc, course: CourseLike) {
  a.status = 'published';
  await a.save();
  notifyCourseStudents(course, {
    title: `מטלה חדשה · ${course.name}`,
    body: `${a.title}, להגשה עד ${a.dueAt.toLocaleString('he-IL', { timeZone: config.timeZone, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    url: `/courses/${course.id}/assignments/${a.id}`,
    tag: `assignment-${a.id}`,
  });
}

/** One assignment. Lecturer: all final submissions + practice counts. Student: own final + practice reviews + class comparison. */
assignmentsRouter.get('/assignments/:aid', requireAuth, async (req, res) => {
  const found = await findAssignment(String(req.params.aid), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Assignment not found' });
    return;
  }
  const { assignment: a, course } = found;
  const names = rosterNames(course);
  if (req.auth!.role === 'lecturer') {
    const [finals, practice] = await Promise.all([
      Submission.find({ assignmentId: a._id, kind: 'final' }, { files: 0 }).sort({ submittedAt: 1 }),
      Submission.aggregate<{ _id: string; n: number }>([{ $match: { assignmentId: a._id, kind: 'practice' } }, { $group: { _id: '$email', n: { $sum: 1 } } }]),
    ]);
    const practiceBy = new Map(practice.map((p) => [p._id, p.n]));
    const submitted = new Set(finals.map((s) => s.email));
    res.json({
      course: { id: course.id, name: course.name },
      assignment: { ...assignmentBase(a), classOverview: a.classOverview ?? null },
      submissions: (finals as unknown as SubmissionDoc[]).map((s) => ({ ...submissionView(s, { lecturer: true, gradesReleased: true, names }), practiceUsed: practiceBy.get(s.email) ?? 0 })),
      missing: course.roster.filter((r) => !submitted.has(r.email.toLowerCase())).map((r) => ({ email: r.email, name: names.get(r.email.toLowerCase()) ?? r.email })),
    });
    return;
  }
  const me = await User.findById(req.auth!.sub, { email: 1 });
  const mine = await Submission.find({ assignmentId: a._id, studentId: req.auth!.sub }, { files: 0 }).sort({ submittedAt: -1 });
  const final = (mine.find((s) => s.kind === 'final') as unknown as SubmissionDoc) ?? null;
  const practice = mine.filter((s) => s.kind === 'practice') as unknown as SubmissionDoc[];
  res.json({
    course: { id: course.id, name: course.name },
    assignment: assignmentBase(a),
    final: final ? submissionView(final, { lecturer: false, gradesReleased: a.gradesReleased }) : null,
    practice: practice.map((s) => submissionView(s, { lecturer: false, gradesReleased: false })),
    practiceLeft: Math.max(0, a.practiceLimit - practice.length),
    classShares: me ? await classShares(a, me.email) : null,
  });
});

assignmentsRouter.put('/assignments/:aid', requireAuth, requireRole('lecturer'), async (req, res) => {
  const found = await findAssignment(String(req.params.aid), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Assignment not found' });
    return;
  }
  const input = readAssignment(req.body, true);
  if ('error' in input) {
    res.status(400).json(input);
    return;
  }
  found.assignment.set(input);
  await found.assignment.save();
  if ((req.body as { publish?: unknown })?.publish === true && found.assignment.status === 'draft') await publish(found.assignment, found.course);
  res.json({ assignment: assignmentBase(found.assignment) });
});

/** Release (or hide) grades and lecturer feedback to students. */
assignmentsRouter.post('/assignments/:aid/release', requireAuth, requireRole('lecturer'), async (req, res) => {
  const found = await findAssignment(String(req.params.aid), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Assignment not found' });
    return;
  }
  const released = (req.body as { released?: unknown })?.released;
  if (typeof released !== 'boolean') {
    res.status(400).json({ error: 'Expected { released }' });
    return;
  }
  const { assignment: a, course } = found;
  const was = a.gradesReleased;
  a.gradesReleased = released;
  await a.save();
  if (released && !was) {
    const graded = await Submission.find({ assignmentId: a._id, kind: 'final', grade: { $exists: true } }, { studentId: 1 });
    notifyInBackground(
      graded.map((s) => String(s.studentId)),
      { title: `הציון פורסם · ${course.name}`, body: a.title, url: `/courses/${course.id}/assignments/${a.id}`, tag: `grades-${a.id}` },
    );
  }
  res.json({ assignment: assignmentBase(a) });
});

assignmentsRouter.delete('/assignments/:aid', requireAuth, requireRole('lecturer'), async (req, res) => {
  const found = await findAssignment(String(req.params.aid), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Assignment not found' });
    return;
  }
  const subs = await Submission.find({ assignmentId: found.assignment._id }, { storedPath: 1 });
  await Promise.all(subs.map((s) => (s.storedPath ? rm(s.storedPath, { force: true }) : null)));
  await Submission.deleteMany({ assignmentId: found.assignment._id });
  await found.assignment.deleteOne();
  res.json({ ok: true });
});

/** Similar final submissions (possible copying), for the lecturer to look at. */
assignmentsRouter.get('/assignments/:aid/similarity', requireAuth, requireRole('lecturer'), async (req, res) => {
  const found = await findAssignment(String(req.params.aid), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Assignment not found' });
    return;
  }
  const finals = await Submission.find({ assignmentId: found.assignment._id, kind: 'final' }, { email: 1, files: 1 });
  const names = rosterNames(found.course);
  const byId = new Map(finals.map((s) => [s.id as string, s]));
  const pairs = similarPairs(finals.map((s) => ({ id: s.id as string, files: s.files.map((f) => ({ path: f.path ?? '', text: f.text ?? '' })) })));
  res.json({
    pairs: pairs.map((p) => ({
      a: { id: p.a, name: names.get(byId.get(p.a)!.email) ?? byId.get(p.a)!.email },
      b: { id: p.b, name: names.get(byId.get(p.b)!.email) ?? byId.get(p.b)!.email },
      score: p.score,
      files: p.files,
    })),
  });
});

/** Class overview from all reviewed finals (runs in the background). */
assignmentsRouter.post('/assignments/:aid/overview', requireAuth, requireRole('lecturer'), async (req, res) => {
  const found = await findAssignment(String(req.params.aid), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Assignment not found' });
    return;
  }
  const id = found.assignment.id as string;
  const reviewed = await Submission.countDocuments({ assignmentId: found.assignment._id, kind: 'final', 'review.status': 'done' });
  if (reviewed < 2) {
    res.status(409).json({ error: 'Not enough reviewed submissions yet' });
    return;
  }
  void enqueueJob('class overview', async () => {
    const a = await Assignment.findById(id);
    if (!a) return;
    const subs = (await Submission.find({ assignmentId: a._id, kind: 'final', 'review.status': 'done' }, { 'review.improvements': 1, 'review.strengths': 1 })) as unknown as SubmissionDoc[];
    const o = await classOverview(a, subs.map((s) => ({ improvements: s.review!.improvements, strengths: s.review!.strengths })), llm);
    a.set({ classOverview: { ...o, generatedAt: new Date(), basedOn: subs.length } });
    await a.save();
  });
  res.status(202).json({ status: 'queued' });
});

// ───────────── routes: submissions ─────────────

/**
 * Student uploads a PDF or ZIP as the raw body. `?kind=final` (replaces their previous final; marked late
 * after the due date) or `?kind=practice` (private AI review, limited per assignment). `fileName` required.
 */
assignmentsRouter.post('/assignments/:aid/submissions', requireAuth, requireRole('student'), async (req, res) => {
  const found = await findAssignment(String(req.params.aid), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Assignment not found' });
    return;
  }
  const { assignment: a } = found;
  const kind = req.query.kind === 'practice' ? 'practice' : req.query.kind === 'final' ? 'final' : null;
  const fileName = typeof req.query.fileName === 'string' ? path.basename(req.query.fileName).slice(0, 200) : '';
  const ext = path.extname(fileName).toLowerCase();
  if (!kind || (ext !== '.pdf' && ext !== '.zip')) {
    res.status(400).json({ error: 'Upload a PDF or ZIP file' });
    return;
  }
  const me = await User.findById(req.auth!.sub, { email: 1 });
  if (!me) {
    res.status(401).json({ error: 'Not logged in' });
    return;
  }
  if (kind === 'practice') {
    const used = await Submission.countDocuments({ assignmentId: a._id, email: me.email, kind: 'practice' });
    if (used >= a.practiceLimit) {
      res.status(409).json({ error: 'No practice reviews left', limit: a.practiceLimit });
      return;
    }
  }

  let data: Buffer;
  let files;
  try {
    data = await readBody(req, SUBMISSION_LIMITS.uploadBytes);
    if (!data.length) throw new ExtractError('The file is empty');
    files = await extractSubmission(fileName, data);
  } catch (e) {
    if (e instanceof ExtractError) {
      res.status(400).json({ error: e.message });
      return;
    }
    if ((e as { status?: number }).status === 413) {
      res.status(413).json({ error: 'File too large', maxMb: SUBMISSION_LIMITS.uploadBytes / 1024 / 1024 });
      return;
    }
    throw e;
  }

  const now = new Date();
  let s = kind === 'final' ? await Submission.findOne({ assignmentId: a._id, email: me.email, kind: 'final' }) : null;
  if (s?.storedPath) await rm(s.storedPath, { force: true });
  if (!s) s = new Submission({ assignmentId: a._id, courseId: a.courseId, email: me.email, studentId: me._id, kind });
  s.set({
    fileName,
    fileSize: data.length,
    files,
    submittedAt: now,
    lateMs: kind === 'final' ? Math.max(0, now.getTime() - a.dueAt.getTime()) : 0,
    review: { status: 'queued', error: '', summary: '', strengths: [], improvements: [], criteria: [], model: '' },
    grade: undefined, // a resubmission needs grading again
  });
  await mkdir(config.submissionsDir, { recursive: true });
  const stored = path.join(config.submissionsDir, `${s.id}${ext}`);
  await writeFile(stored, data);
  s.storedPath = stored;
  await s.save();
  void enqueueReview(s.id);
  res.status(201).json({ submission: submissionView(s, { lecturer: false, gradesReleased: false }) });
});

/** One submission with the extracted text (lecturer, or its own student). */
assignmentsRouter.get('/submissions/:sid', requireAuth, async (req, res) => {
  const found = await findSubmission(String(req.params.sid), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Submission not found' });
    return;
  }
  const lecturer = req.auth!.role === 'lecturer';
  const { submission: s, assignment: a, course } = found;
  res.json({
    assignment: assignmentBase(a),
    submission: submissionView(s, { lecturer, gradesReleased: a.gradesReleased, names: rosterNames(course) }),
    contents: s.files.map((f) => ({ path: f.path, text: f.text, code: f.code })),
  });
});

/** The original uploaded file. */
assignmentsRouter.get('/submissions/:sid/file', requireAuth, async (req, res) => {
  const found = await findSubmission(String(req.params.sid), req.auth!);
  if (!found?.submission.storedPath) {
    res.status(404).json({ error: 'Submission not found' });
    return;
  }
  res.download(found.submission.storedPath, found.submission.fileName);
});

/** Lecturer grade: points per criterion (clamped) and a comment; total = sum unless given. */
assignmentsRouter.put('/submissions/:sid/grade', requireAuth, requireRole('lecturer'), async (req, res) => {
  const found = await findSubmission(String(req.params.sid), req.auth!);
  if (!found || found.submission.kind !== 'final') {
    res.status(404).json({ error: 'Submission not found' });
    return;
  }
  const { submission: s, assignment: a } = found;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const crit = criteriaOf(a);
  const given = Array.isArray(b.criteria) ? (b.criteria as { criterionId?: unknown; points?: unknown }[]) : [];
  const perCriterion = crit.map((c) => {
    const g = given.find((x) => x?.criterionId === c.id);
    const p = Number(g?.points ?? 0);
    return { criterionId: c.id, points: Number.isFinite(p) ? Math.min(Math.max(p, 0), c.points) : 0 };
  });
  const total = b.points !== undefined ? Number(b.points) : perCriterion.reduce((n, c) => n + c.points, 0);
  if (!Number.isFinite(total) || total < 0 || total > a.maxPoints) {
    res.status(400).json({ error: 'Invalid grade', maxPoints: a.maxPoints });
    return;
  }
  s.set({ grade: { points: Math.round(total * 10) / 10, criteria: perCriterion, comment: typeof b.comment === 'string' ? b.comment.trim().slice(0, 3000) : '', gradedAt: new Date() } });
  await s.save();
  res.json({ submission: submissionView(s, { lecturer: true, gradesReleased: true, names: rosterNames(found.course) }) });
});

/** Run the AI review again (e.g. after a failure). */
assignmentsRouter.post('/submissions/:sid/review', requireAuth, async (req, res) => {
  const found = await findSubmission(String(req.params.sid), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Submission not found' });
    return;
  }
  const s = found.submission;
  if (req.auth!.role !== 'lecturer' && s.review?.status !== 'failed') {
    res.status(409).json({ error: 'Review already done' });
    return;
  }
  s.set({ 'review.status': 'queued', 'review.error': '' });
  await s.save();
  void enqueueReview(s.id);
  res.json({ submission: submissionView(s, { lecturer: req.auth!.role === 'lecturer', gradesReleased: found.assignment.gradesReleased }) });
});
