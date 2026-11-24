import type { PollType } from '../models/Poll.js';

export const POLL_LIMITS = {
  questionMax: 300,
  optionMax: 120,
  minOptions: 2,
  maxOptions: 6,
  textAnswerMax: 200,
  scaleMin: 1,
  scaleMax: 5,
} as const;

export const YES_NO_OPTIONS = [
  { id: 'yes', text: 'כן' },
  { id: 'no', text: 'לא' },
];

export interface PollInput {
  question: string;
  type: PollType;
  multiple: boolean;
  options: { id: string; text: string }[];
  correctOptionIds: string[];
  audience: 'roster' | 'present';
  showTextOnScreen: boolean;
}

/** Validates a lecturer's poll definition. Returns the normalized poll or an error message. */
export function readPollInput(body: unknown): PollInput | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const question = typeof b.question === 'string' ? b.question.trim() : '';
  if (!question) return { error: 'Question is required' };
  if (question.length > POLL_LIMITS.questionMax) return { error: 'Question is too long' };
  const type = b.type as PollType;
  if (!['choice', 'yesno', 'scale', 'text'].includes(type)) return { error: 'Invalid poll type' };
  const audience = b.audience === 'present' ? 'present' : 'roster';
  if (b.audience !== undefined && b.audience !== 'present' && b.audience !== 'roster') return { error: 'Invalid audience' };

  let options: { id: string; text: string }[] = [];
  if (type === 'choice') {
    if (!Array.isArray(b.options)) return { error: 'Options are required' };
    const texts = b.options.map((o) => (typeof o === 'string' ? o : (o as { text?: unknown })?.text)).map((t) => (typeof t === 'string' ? t.trim() : ''));
    if (texts.some((t) => !t)) return { error: 'Options cannot be empty' };
    if (texts.length < POLL_LIMITS.minOptions || texts.length > POLL_LIMITS.maxOptions) return { error: 'A poll needs 2–6 options' };
    if (texts.some((t) => t.length > POLL_LIMITS.optionMax)) return { error: 'Option is too long' };
    if (new Set(texts).size !== texts.length) return { error: 'Options must be different' };
    options = texts.map((text, i) => ({ id: `o${i + 1}`, text }));
  } else if (type === 'yesno') {
    options = YES_NO_OPTIONS;
  }

  const multiple = type === 'choice' && b.multiple === true;
  let correctOptionIds: string[] = [];
  if (b.correct !== undefined && b.correct !== null) {
    // `correct` = indexes into the submitted options (choice) or 'yes'/'no'.
    if (!Array.isArray(b.correct) || (type !== 'choice' && type !== 'yesno')) return { error: 'Invalid correct answer' };
    for (const c of b.correct) {
      const id = type === 'yesno' ? (c === 'yes' || c === 'no' ? c : null) : Number.isInteger(c) && options[c as number] ? options[c as number].id : null;
      if (!id) return { error: 'Invalid correct answer' };
      if (!correctOptionIds.includes(id)) correctOptionIds.push(id);
    }
    if (!multiple && correctOptionIds.length > 1) return { error: 'Invalid correct answer' };
  }
  return { question, type, multiple, options, correctOptionIds, audience, showTextOnScreen: b.showTextOnScreen !== false };
}

export interface ResponseValue {
  optionIds?: string[];
  value?: number;
  text?: string;
}

/** Validates a student's answer against the poll. */
export function readResponse(poll: { type: string; multiple: boolean; options: { id: string }[] }, body: unknown): ResponseValue | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (poll.type === 'choice' || poll.type === 'yesno') {
    const ids = Array.isArray(b.optionIds) ? [...new Set(b.optionIds)] : null;
    const valid = new Set(poll.options.map((o) => o.id));
    if (!ids || ids.length === 0 || ids.some((id) => typeof id !== 'string' || !valid.has(id))) return { error: 'Invalid answer' };
    if (!poll.multiple && ids.length > 1) return { error: 'Choose one answer' };
    return { optionIds: ids as string[] };
  }
  if (poll.type === 'scale') {
    const v = b.value;
    if (!Number.isInteger(v) || (v as number) < POLL_LIMITS.scaleMin || (v as number) > POLL_LIMITS.scaleMax) return { error: 'Invalid answer' };
    return { value: v as number };
  }
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) return { error: 'Invalid answer' };
  if (text.length > POLL_LIMITS.textAnswerMax) return { error: 'Answer is too long' };
  return { text };
}

export interface PollResults {
  responses: number;
  /** Choice / yes-no: votes per option (multi-select counts each selected option). */
  counts?: Record<string, number>;
  /** Scale: votes per value 1..5 and the average. */
  scale?: { counts: number[]; average: number | null };
  /** Text: answers, newest first (no names). */
  texts?: string[];
}

export function aggregate(poll: { type: string; options: { id: string }[] }, responses: ResponseValue[]): PollResults {
  const out: PollResults = { responses: responses.length };
  if (poll.type === 'choice' || poll.type === 'yesno') {
    out.counts = Object.fromEntries(poll.options.map((o) => [o.id, 0]));
    for (const r of responses) for (const id of r.optionIds ?? []) if (id in out.counts) out.counts[id]++;
  } else if (poll.type === 'scale') {
    const counts = Array(POLL_LIMITS.scaleMax).fill(0) as number[];
    let sum = 0;
    let n = 0;
    for (const r of responses) {
      if (typeof r.value !== 'number') continue;
      counts[r.value - 1]++;
      sum += r.value;
      n++;
    }
    out.scale = { counts, average: n ? Math.round((sum / n) * 10) / 10 : null };
  } else {
    out.texts = responses.map((r) => r.text ?? '').filter(Boolean);
  }
  return out;
}
