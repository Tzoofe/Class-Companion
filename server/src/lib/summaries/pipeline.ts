import { rm } from 'node:fs/promises';
import { Course } from '../../models/Course.js';
import { LessonSummary } from '../../models/LessonSummary.js';
import { Poll, PollResponse } from '../../models/Poll.js';
import { Post } from '../../models/Post.js';
import { aggregate } from '../polls.js';
import { pollHeadline } from '../recap.js';
import { ollamaClient, type LlmClient } from './llm.js';
import { summarizeLesson, type ClassContext } from './summarize.js';
import { whisperTranscriber, type Transcriber } from './transcribe.js';

let transcriber: Transcriber = whisperTranscriber;
let llm: LlmClient = ollamaClient;
/** Tests swap in fakes. */
export function setSummaryEngines(engines: { transcriber?: Transcriber | null; llm?: LlmClient | null }) {
  if (engines.transcriber !== undefined) transcriber = engines.transcriber ?? whisperTranscriber;
  if (engines.llm !== undefined) llm = engines.llm ?? ollamaClient;
}

/** Questions and poll results from the lesson's session, for "where students struggled". */
async function classContext(courseName: string, sessionId: unknown): Promise<ClassContext> {
  if (!sessionId) return { courseName, questions: [], polls: [] };
  const [posts, polls] = await Promise.all([
    Post.find({ sessionId, kind: 'question', hidden: false }, { text: 1 }).limit(40),
    Poll.find({ sessionId, status: { $ne: 'draft' } }),
  ]);
  const responses = await PollResponse.find({ pollId: { $in: polls.map((p) => p._id) } });
  return {
    courseName,
    questions: posts.map((p) => p.text),
    polls: polls.map((p) => {
      const results = aggregate(p, responses.filter((r) => String(r.pollId) === String(p._id)).map((r) => ({ optionIds: r.optionIds ?? undefined, value: r.value ?? undefined, text: r.text ?? undefined })));
      const top = pollHeadline(p, results);
      return { question: p.question, result: top ? `${results.responses} ענו; ${top.percent !== null ? `${top.percent}% בחרו "${top.text}"` : top.text}` : 'אין תשובות' };
    }),
  };
}

async function process(id: string) {
  const doc = await LessonSummary.findById(id);
  if (!doc || (doc.status !== 'queued' && doc.status !== 'transcribing' && doc.status !== 'summarizing')) return;
  try {
    if (doc.mediaPath) {
      doc.set({ status: 'transcribing', progress: 5, error: '' });
      await doc.save();
      const segments = await transcriber(doc.mediaPath);
      await rm(doc.mediaPath, { force: true });
      doc.set({ transcript: segments, mediaPath: undefined, progress: 40 });
      await doc.save();
    }
    const course = await Course.findById(doc.courseId, { name: 1 });
    doc.set({ status: 'summarizing' });
    await doc.save();
    const content = await summarizeLesson(doc.transcript.map((s) => ({ start: s.start ?? 0, end: s.end ?? 0, text: s.text ?? '' })), await classContext(course?.name ?? '', doc.sessionId), llm, (done, total) => {
      void LessonSummary.updateOne({ _id: doc._id }, { $set: { progress: 40 + Math.round((done / total) * 58) } });
    });
    doc.set({ content, status: 'draft', progress: 100 });
    await doc.save();
  } catch (e) {
    doc.set({ status: 'failed', error: (e as Error).message.slice(0, 400) });
    await doc.save();
  }
}

// One job at a time: transcription and the local model each use most of the machine.
let chain: Promise<void> = Promise.resolve();
export function enqueueSummary(id: string) {
  chain = chain.then(() => process(id)).catch((e) => console.error('summary job failed', e));
  return chain;
}
/** Resolves when all queued jobs finished (tests). */
export const settleSummaries = () => chain;

/** On startup: jobs cut off by a restart are queued again. */
export async function resumeSummaryJobs() {
  const stuck = await LessonSummary.find({ status: { $in: ['queued', 'transcribing', 'summarizing'] } }, { _id: 1 });
  for (const s of stuck) enqueueSummary(String(s._id));
  return stuck.length;
}
