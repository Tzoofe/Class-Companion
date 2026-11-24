import { config } from '../../config.js';
import type { LlmClient } from '../summaries/llm.js';
import type { ExtractedFile } from './extract.js';

export interface Criterion {
  id: string;
  title: string;
  description: string;
  points: number;
}

export type Met = 'yes' | 'partial' | 'no' | 'unknown';

export interface ReviewResult {
  summary: string;
  /** One sentence on how the student approached the task (no quotes), for class comparisons. */
  approach: string;
  strengths: string[];
  improvements: string[];
  criteria: { criterionId: string; met: Met; feedback: string; suggestion: string; points: number }[];
}

/** What fits in one prompt for an 8B local model (with room for instructions and the answer). */
const CONTENT_BUDGET = 14_000;

/** The submission as prompt text: a file list, then each file, trimmed evenly to fit the budget. */
export function submissionText(files: ExtractedFile[], budget = CONTENT_BUDGET): { text: string; truncated: boolean } {
  const total = files.reduce((n, f) => n + f.text.length, 0);
  const share = total > budget ? budget / total : 1;
  const parts = files.map((f) => {
    const keep = Math.max(300, Math.floor(f.text.length * share));
    const cut = f.text.length > keep;
    return `=== קובץ: ${f.path} ===\n${cut ? `${f.text.slice(0, keep)}\n[...קוצר...]` : f.text}`;
  });
  return { text: `קבצים בהגשה: ${files.map((f) => f.path).join(', ')}\n\n${parts.join('\n\n')}`, truncated: share < 1 };
}

const SYSTEM = `אתה מתרגל/ת באוניברסיטה שבודק/ת עבודות בית. כתוב משוב בעברית, ענייני, ספציפי ומכבד, שעוזר לסטודנט להשתפר.
התבסס רק על מה שמופיע בהגשה. ציין שמות קבצים, פונקציות או סעיפים כשאתה מתייחס אליהם. אל תמציא תוכן שלא קיים בהגשה.
אם חלק מההגשה קוצר, אל תניח שהוא חסר.`;

export function reviewPrompt(a: { title: string; instructions: string; criteria: Criterion[] }, files: ExtractedFile[]) {
  const { text, truncated } = submissionText(files);
  const criteria = a.criteria.length
    ? a.criteria.map((c) => `- [${c.id}] ${c.title}${c.description ? `: ${c.description}` : ''} (${c.points} נקודות)`).join('\n')
    : '- [general] איכות ונכונות כללית של הפתרון (0 נקודות)';
  return `מטלה: ${a.title}

הוראות המטלה:
${a.instructions || '(לא צוינו)'}

קריטריונים לבדיקה:
${criteria}
${truncated ? '\nשים לב: ההגשה ארוכה וחלקים ממנה קוצרו.\n' : ''}
ההגשה:
${text}

כתוב:
- summary: הערכה כללית ב-2 עד 3 משפטים.
- approach: משפט אחד שמתאר את הגישה של הפתרון (למשל "רקורסיה עם מקרה בסיס n == 0" או "לולאה עם משתנה צובר"), בלי לצטט מההגשה.
- strengths: עד 3 דברים שנעשו היטב.
- improvements: עד 4 שיפורים קונקרטיים, החשוב ביותר קודם.
- criteria: לכל קריטריון (לפי המזהה בסוגריים): met (yes = עומד בדרישה במלואה, partial = חלקית, no = חסר), feedback (מה ראית בהגשה), suggestion (מה לשפר).`;
}

export function reviewSchema(criteria: Criterion[]) {
  const ids = criteria.length ? criteria.map((c) => c.id) : ['general'];
  const str = { type: 'string' };
  return {
    type: 'object',
    properties: {
      summary: str,
      approach: str,
      strengths: { type: 'array', items: str },
      improvements: { type: 'array', items: str },
      criteria: {
        type: 'array',
        items: {
          type: 'object',
          properties: { criterionId: { type: 'string', enum: ids }, met: { type: 'string', enum: ['yes', 'partial', 'no'] }, feedback: str, suggestion: str },
          required: ['criterionId', 'met', 'feedback', 'suggestion'],
        },
      },
    },
    required: ['summary', 'approach', 'strengths', 'improvements', 'criteria'],
  };
}

/** Removes markdown emphasis the model sometimes adds ("**title:** text" → "title: text"). */
const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').trim();
const list = (xs: unknown, max: number) => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(plain).slice(0, max) : []);

/**
 * Suggested points come from the verdict, not from the model (small models get number scales wrong):
 * met = full points, partial = half, missing or not reviewed = 0. The lecturer sets the final grade.
 */
export const POINTS_FOR: Record<Met, number> = { yes: 1, partial: 0.5, no: 0, unknown: 0 };

/** Cleans the model's answer: one entry per criterion in order, points from the verdict, missing ones marked unknown. */
export function normalizeReview(raw: unknown, criteria: Criterion[]): ReviewResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const given = new Map(
    (Array.isArray(r.criteria) ? r.criteria : [])
      .filter((c): c is Record<string, unknown> => !!c && typeof (c as { criterionId?: unknown }).criterionId === 'string')
      .map((c) => [c.criterionId as string, c]),
  );
  const crits = criteria.length ? criteria : [{ id: 'general', title: '', description: '', points: 0 }];
  return {
    summary: typeof r.summary === 'string' ? plain(r.summary) : '',
    approach: typeof r.approach === 'string' ? plain(r.approach).slice(0, 200) : '',
    strengths: list(r.strengths, 3),
    improvements: list(r.improvements, 4),
    criteria: crits.map((c) => {
      const g = given.get(c.id);
      if (!g) return { criterionId: c.id, met: 'unknown' as Met, feedback: '', suggestion: '', points: 0 };
      const met = (['yes', 'partial', 'no'] as const).includes(g.met as 'yes') ? (g.met as Met) : 'unknown';
      return {
        criterionId: c.id,
        met,
        feedback: typeof g.feedback === 'string' ? plain(g.feedback) : '',
        suggestion: typeof g.suggestion === 'string' ? plain(g.suggestion) : '',
        points: Math.round(c.points * POINTS_FOR[met] * 10) / 10,
      };
    }),
  };
}

/** Code goes to the coding model; prose to the general (Hebrew) model. */
export const modelFor = (code: boolean) => (code ? config.ollama.codeModel : config.ollama.model);

export async function reviewSubmission(
  assignment: { title: string; instructions: string; criteria: Criterion[] },
  files: ExtractedFile[],
  llm: LlmClient,
  code: boolean,
): Promise<ReviewResult> {
  const raw = await llm({ system: SYSTEM, user: reviewPrompt(assignment, files), schema: reviewSchema(assignment.criteria), model: modelFor(code) });
  return normalizeReview(raw, assignment.criteria);
}

const OVERVIEW_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' }, commonIssues: { type: 'array', items: { type: 'string' } }, strengths: { type: 'array', items: { type: 'string' } } },
  required: ['summary', 'commonIssues', 'strengths'],
};

/** Class-level view for the lecturer, from the individual reviews (no student names are sent). */
export async function classOverview(assignment: { title: string }, reviews: { improvements: string[]; strengths: string[] }[], llm: LlmClient) {
  const issues = reviews.flatMap((r) => r.improvements).map((x) => `- ${x}`).join('\n');
  const good = reviews.flatMap((r) => r.strengths).map((x) => `- ${x}`).join('\n');
  const raw = (await llm({
    system: SYSTEM,
    user: `מטלה: ${assignment.title}
נבדקו ${reviews.length} הגשות. אלה השיפורים שהוצעו לסטודנטים:
${issues || '(אין)'}

ואלה נקודות החוזק שצוינו:
${good || '(אין)'}

כתוב:
- summary: תמונת מצב של הכיתה ב-2 עד 3 משפטים.
- commonIssues: עד 5 טעויות או חוסרים שחזרו אצל כמה סטודנטים, החשוב ביותר קודם (ציין בערך כמה).
- strengths: עד 3 דברים שרוב הכיתה עשתה טוב.`,
    schema: OVERVIEW_SCHEMA,
  })) as Record<string, unknown>;
  return { summary: typeof raw.summary === 'string' ? raw.summary.trim() : '', commonIssues: list(raw.commonIssues, 5), strengths: list(raw.strengths, 3) };
}

// ── Comparison with the class (after the deadline) ──

export interface ClassPatterns {
  approaches: { description: string; count: number }[];
  commonStrengths: string[];
  commonGaps: string[];
}

const PATTERNS_SCHEMA = {
  type: 'object',
  properties: {
    approaches: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, count: { type: 'number' } }, required: ['description', 'count'] } },
    commonStrengths: { type: 'array', items: { type: 'string' } },
    commonGaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['approaches', 'commonStrengths', 'commonGaps'],
};

/**
 * Groups the class into a few anonymous patterns. Input is the reviews only (approach sentences,
 * strengths, improvements), never submission text, so nothing a classmate wrote can leak.
 */
export async function classPatterns(
  assignment: { title: string },
  reviews: { approach: string; summary: string; strengths: string[]; improvements: string[] }[],
  llm: LlmClient,
): Promise<ClassPatterns> {
  const lines = reviews.map((r, i) => `${i + 1}. גישה: ${r.approach || r.summary.slice(0, 160)} | חוזקות: ${r.strengths.join('; ')} | לשיפור: ${r.improvements.join('; ')}`).join('\n');
  const raw = (await llm({
    system: SYSTEM,
    user: `מטלה: ${assignment.title}
לפניך תקצירים אנונימיים של ${reviews.length} הגשות (גישה, חוזקות, שיפורים):
${lines}

כתוב:
- approaches: עד 5 גישות שונות לפתרון שהופיעו בכיתה, עם count = בערך כמה הגשות נקטו בכל גישה. אחד גישות דומות.
- commonStrengths: עד 3 דברים שרוב הכיתה עשתה היטב.
- commonGaps: עד 4 דברים שחסרו אצל חלק ניכר מהכיתה.
אל תזכיר מספרי הגשות ואל תצטט.`,
    schema: PATTERNS_SCHEMA,
  })) as Record<string, unknown>;
  const approaches = Array.isArray(raw.approaches)
    ? (raw.approaches as { description?: unknown; count?: unknown }[])
        .filter((a) => typeof a?.description === 'string' && a.description.trim())
        .map((a) => ({ description: plain(String(a.description)), count: Math.max(1, Math.min(reviews.length, Math.round(Number(a.count) || 1))) }))
        .slice(0, 5)
    : [];
  return { approaches, commonStrengths: list(raw.commonStrengths, 3), commonGaps: list(raw.commonGaps, 4) };
}

export interface Comparison {
  summary: string;
  likeMost: string[];
  othersDid: string[];
  standOut: string[];
}

const COMPARISON_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
};

/** A criterion counts as "most of the class" at 50% and up. */
const MAJORITY = 50;

/**
 * The student's work vs. the class. The three lists come only from the per-criterion numbers (facts);
 * the model writes just the summary paragraph (small models invent comparisons when asked for lists).
 */
export async function compareToClass(
  assignment: { title: string; criteria: Criterion[] },
  mine: { approach: string; summary: string; strengths: string[]; improvements: string[]; criteria: { criterionId: string; met: Met }[] },
  patterns: ClassPatterns,
  shares: Record<string, number>,
  classSize: number,
  llm: LlmClient,
): Promise<Comparison> {
  const likeMost: string[] = [];
  const othersDid: string[] = [];
  const standOut: string[] = [];
  for (const c of assignment.criteria) {
    const met = mine.criteria.find((x) => x.criterionId === c.id)?.met ?? 'unknown';
    const share = shares[c.id];
    if (share === undefined || met === 'unknown') continue;
    if (met === 'yes' && share >= MAJORITY) likeMost.push(`${c.title}: עמדת בדרישה, כמו ${share}% מהכיתה`);
    else if (met === 'yes') standOut.push(`${c.title}: עמדת בדרישה, ורק ${share}% מהכיתה עמדו בה`);
    else if (share >= MAJORITY) othersDid.push(`${c.title}: ${share}% מהכיתה עמדו בדרישה, ואצלך ${met === 'partial' ? 'זה חלקי' : 'זה חסר'}`);
  }

  const facts = [
    likeMost.length ? `כמו רוב הכיתה: ${likeMost.join('; ')}` : '',
    othersDid.length ? `רוב הכיתה עשתה ואצלך חסר: ${othersDid.join('; ')}` : '',
    standOut.length ? `בולט לטובה: ${standOut.join('; ')}` : '',
  ].filter(Boolean).join('\n');
  const raw = (await llm({
    system: SYSTEM,
    user: `מטלה: ${assignment.title}
השוואה של הגשה אחת לכיתה (${classSize} הגשות אחרות). כתוב לסטודנט, בגוף שני.

הגישה בהגשה שלך: ${mine.approach || mine.summary}
הגישות בכיתה: ${patterns.approaches.map((a) => `${a.description} (${a.count})`).join('; ') || '(לא ידוע)'}
מה שרוב הכיתה עשתה היטב: ${patterns.commonStrengths.join('; ') || '(אין)'}
החוזקות שלך: ${mine.strengths.join('; ') || '(אין)'}

עובדות לפי קריטריונים:
${facts || '(אין הבדלים בולטים)'}

כתוב:
- summary: 2 עד 3 משפטים: איפה ההגשה עומדת ביחס לכיתה, כולל אם הגישה שלך נפוצה או ייחודית. התבסס רק על העובדות למעלה.
אל תזכיר סטודנטים אחרים ואל תצטט הגשות.`,
    schema: COMPARISON_SCHEMA,
  })) as Record<string, unknown>;
  return {
    summary: typeof raw.summary === 'string' ? plain(raw.summary) : '',
    likeMost,
    othersDid,
    standOut,
  };
}

export interface GradeStats {
  count: number;
  mean: number;
  median: number;
  /** 10 equal-width bins from 0 to maxPoints. */
  bins: number[];
  binWidth: number;
}

/** Grade distribution (anonymous). */
export function gradeStats(points: number[], maxPoints: number): GradeStats {
  const sorted = [...points].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const binWidth = maxPoints / 10;
  const bins = Array(10).fill(0) as number[];
  for (const p of sorted) bins[Math.min(9, Math.floor(p / binWidth))]++;
  return { count: n, mean: Math.round((sorted.reduce((a, b) => a + b, 0) / n) * 10) / 10, median: Math.round(median * 10) / 10, bins, binWidth };
}
