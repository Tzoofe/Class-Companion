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
    required: ['summary', 'strengths', 'improvements', 'criteria'],
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
