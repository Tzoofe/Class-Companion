import type { LlmClient } from './llm.js';
import { chunkTranscript, formatTime, type Segment } from './transcript.js';

export interface LessonSummaryContent {
  overview: string;
  topics: { at: number | null; title: string; points: string[] }[];
  concepts: { term: string; definition: string }[];
  reminders: string[];
  confusion: string[];
  reviewQuestions: string[];
}

/** What happened in class besides the recording: used for "where students were confused". */
export interface ClassContext {
  courseName: string;
  questions: string[];
  polls: { question: string; result: string }[];
}

interface ChunkNotes {
  topics: { title: string; points: string[] }[];
  concepts: { term: string; definition: string }[];
  reminders: string[];
}

const str = { type: 'string' };
const strList = { type: 'array', items: str };
const CHUNK_SCHEMA = {
  type: 'object',
  properties: {
    topics: { type: 'array', items: { type: 'object', properties: { title: str, points: strList }, required: ['title', 'points'] } },
    concepts: { type: 'array', items: { type: 'object', properties: { term: str, definition: str }, required: ['term', 'definition'] } },
    reminders: strList,
  },
  required: ['topics', 'concepts', 'reminders'],
};
const FINAL_SCHEMA = {
  type: 'object',
  properties: { overview: str, confusion: strList, reviewQuestions: strList },
  required: ['overview', 'confusion', 'reviewQuestions'],
};

const SYSTEM = `אתה עוזר הוראה באוניברסיטה. אתה כותב סיכומי שיעור בעברית תקנית, קצרים וענייניים, לסטודנטים.
כתוב רק על סמך התוכן שקיבלת. אל תמציא עובדות, מספרים או הגדרות שלא נאמרו בשיעור.
התמלול נוצר אוטומטית ועלול להכיל שגיאות; אם מילה נראית שגויה, הסק את הכוונה מההקשר.`;

function chunkPrompt(text: string, index: number, total: number, from: string, to: string) {
  return `זהו חלק ${index + 1} מתוך ${total} של תמלול השיעור (${from}–${to}).

סכם את החלק הזה:
- topics: הנושאים שנלמדו בחלק הזה, לפי הסדר. לכל נושא כותרת קצרה ו-1 עד 4 נקודות עיקריות.
- concepts: מושגים או הגדרות שהמרצה הסביר/ה (מונח והגדרה קצרה). רשימה ריקה אם אין.
- reminders: דברים שהמרצה ביקש/ה לזכור: שיעורי בית, מועדי הגשה, "זה יופיע במבחן". רשימה ריקה אם אין.

תמלול:
${text}`;
}

function finalPrompt(notes: string, ctx: ClassContext) {
  const questions = ctx.questions.length ? ctx.questions.map((q) => `- ${q}`).join('\n') : '(לא נשאלו שאלות באפליקציה)';
  const polls = ctx.polls.length ? ctx.polls.map((p) => `- ${p.question}: ${p.result}`).join('\n') : '(לא היו סקרים)';
  return `קורס: ${ctx.courseName}

סיכום השיעור לפי חלקים:
${notes}

שאלות שסטודנטים שאלו באפליקציה במהלך השיעור:
${questions}

תוצאות סקרים מהשיעור:
${polls}

כתוב:
- overview: סקירה של השיעור כולו ב-3 עד 5 משפטים.
- confusion: עד 4 נקודות שבהן נראה שסטודנטים התקשו, רק על סמך השאלות והסקרים למעלה (למשל "רבים ענו 'לא' לשאלה X אחרי הנושא Y"). רשימה ריקה אם אין סימן לקושי.
- reviewQuestions: 3 עד 5 שאלות חזרה קצרות על החומר.`;
}

const clean = (xs: unknown): string[] => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []);

/** Same term or reminder written twice in different chunks → keep the first. */
function dedupe<T>(items: T[], key: (t: T) => string) {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t).trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Summarizes a lesson in two passes so a small local model can handle a 90-minute transcript:
 * notes per ~10-minute chunk (topics keep the chunk's start time), then one pass for the overview,
 * where students struggled, and review questions.
 */
export async function summarizeLesson(
  segments: Segment[],
  ctx: ClassContext,
  llm: LlmClient,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<LessonSummaryContent> {
  const chunks = chunkTranscript(segments);
  if (!chunks.length) throw new Error('The transcript is empty');
  const hasTimes = segments.some((s) => s.end > 0);

  const notes: (ChunkNotes & { at: number | null })[] = [];
  for (const [i, c] of chunks.entries()) {
    const raw = (await llm({ system: SYSTEM, user: chunkPrompt(c.text, i, chunks.length, formatTime(c.start), formatTime(c.end)), schema: CHUNK_SCHEMA })) as Partial<ChunkNotes>;
    notes.push({
      at: hasTimes ? c.start : null,
      topics: (raw.topics ?? []).filter((t) => t?.title).map((t) => ({ title: t.title.trim(), points: clean(t.points) })),
      concepts: (raw.concepts ?? []).filter((x) => x?.term && x?.definition).map((x) => ({ term: x.term.trim(), definition: x.definition.trim() })),
      reminders: clean(raw.reminders),
    });
    onProgress(i + 1, chunks.length + 1);
  }

  const notesText = notes
    .map((n, i) => `חלק ${i + 1}${n.at !== null ? ` (${formatTime(n.at)})` : ''}:\n${n.topics.map((t) => `- ${t.title}: ${t.points.join('; ')}`).join('\n')}`)
    .join('\n\n');
  const final = (await llm({ system: SYSTEM, user: finalPrompt(notesText, ctx), schema: FINAL_SCHEMA })) as Partial<LessonSummaryContent>;
  onProgress(chunks.length + 1, chunks.length + 1);

  return {
    overview: typeof final.overview === 'string' ? final.overview.trim() : '',
    topics: notes.flatMap((n) => n.topics.map((t, j) => ({ at: j === 0 ? n.at : null, ...t }))),
    concepts: dedupe(notes.flatMap((n) => n.concepts), (c) => c.term),
    reminders: dedupe(notes.flatMap((n) => n.reminders), (r) => r),
    confusion: clean(final.confusion).slice(0, 4),
    reviewQuestions: clean(final.reviewQuestions).slice(0, 5),
  };
}
