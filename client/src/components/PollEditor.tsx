import { useState, type FormEvent } from 'react';
import type { LecturerPoll, PollDraft, PollType } from '../api';
import { ErrorBox } from './ui';

const TYPES: [PollType, string][] = [
  ['choice', 'בחירה'],
  ['yesno', 'כן / לא'],
  ['scale', 'סולם 1–5'],
  ['text', 'טקסט חופשי'],
];
const MAX_OPTIONS = 6;

export const emptyDraft = (): PollDraft => ({
  question: '',
  type: 'choice',
  multiple: false,
  options: ['', ''],
  correct: [],
  audience: 'roster',
  showTextOnScreen: true,
});

/** Turns a saved poll back into editor fields. */
export function draftFromPoll(p: LecturerPoll): PollDraft {
  return {
    question: p.question,
    type: p.type,
    multiple: p.multiple,
    options: p.type === 'choice' ? p.options.map((o) => o.text) : ['', ''],
    correct:
      p.type === 'yesno'
        ? (p.correctOptionIds.filter((id) => id === 'yes' || id === 'no') as ('yes' | 'no')[])
        : p.correctOptionIds.map((id) => p.options.findIndex((o) => o.id === id)).filter((i) => i >= 0),
    audience: p.audience,
    showTextOnScreen: p.showTextOnScreen,
  };
}

/** Body for the API: only the fields that apply to the chosen type. */
export function toBody(d: PollDraft) {
  return {
    question: d.question,
    type: d.type,
    multiple: d.type === 'choice' && d.multiple,
    options: d.type === 'choice' ? d.options.map((o) => o.trim()) : undefined,
    correct: d.type === 'choice' || d.type === 'yesno' ? d.correct : undefined,
    audience: d.audience,
    showTextOnScreen: d.showTextOnScreen,
  };
}

/** Create or edit a poll: type, question, options, single/multiple, correct answer, who can answer. */
export default function PollEditor({
  initial,
  sessionActive,
  onSubmit,
  onCancel,
  submitLabels,
}: {
  initial: PollDraft;
  sessionActive: boolean;
  onSubmit: (draft: PollDraft, open: boolean) => Promise<void>;
  onCancel?: () => void;
  submitLabels: { open?: string; save: string };
}) {
  const [d, setD] = useState<PollDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<PollDraft>) => setD((x) => ({ ...x, ...patch }));

  function setType(type: PollType) {
    set({ type, correct: [], multiple: type === 'choice' ? d.multiple : false });
  }

  function toggleCorrect(c: number | 'yes' | 'no') {
    const has = d.correct.includes(c);
    if (d.type === 'choice' && d.multiple) set({ correct: has ? d.correct.filter((x) => x !== c) : [...d.correct, c] });
    else set({ correct: has ? [] : [c] });
  }

  function removeOption(i: number) {
    set({
      options: d.options.filter((_, j) => j !== i),
      // Shift correct indexes after the removed option.
      correct: d.correct.filter((c) => c !== i).map((c) => (typeof c === 'number' && c > i ? c - 1 : c)),
    });
  }

  async function submit(open: boolean, e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(d, open);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const presentNeedsSession = d.audience === 'present' && !sessionActive;

  return (
    <form onSubmit={(e) => submit(!!submitLabels.open, e)} className="space-y-4 card p-4">
      <div className="flex flex-wrap gap-1 rounded-xl bg-surface-2 p-0.5 text-sm">
        {TYPES.map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`flex-1 rounded-md px-3 py-1.5 ${d.type === t ? 'bg-surface-2 font-medium ' : 'text-ink-2'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <textarea
        value={d.question}
        onChange={(e) => set({ question: e.target.value.slice(0, 300) })}
        rows={2}
        placeholder={d.type === 'scale' ? 'למשל: עד כמה הנושא ברור לכם?' : d.type === 'text' ? 'למשל: מה הדבר הכי לא ברור בנושא?' : 'השאלה'}
        className="w-full rounded-xl border border-line-strong px-3 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      />

      {d.type === 'choice' && (
        <div className="space-y-2">
          {d.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleCorrect(i)}
                title="סימון כתשובה נכונה"
                aria-pressed={d.correct.includes(i)}
                className={`h-8 w-8 shrink-0 rounded-full text-sm ring-1 ${d.correct.includes(i) ? 'bg-good-strong text-white ring-good-strong' : 'text-ink-4 ring-line-strong hover:bg-surface'}`}
              >
                ✓
              </button>
              <input
                value={o}
                onChange={(e) => set({ options: d.options.map((x, j) => (j === i ? e.target.value.slice(0, 120) : x)) })}
                placeholder={`אפשרות ${i + 1}`}
                className="min-w-0 flex-1 rounded-xl border border-line-strong px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
              {d.options.length > 2 && (
                <button type="button" onClick={() => removeOption(i)} className="shrink-0 px-2 text-ink-4 hover:text-bad" aria-label="הסרת אפשרות">
                  ✕
                </button>
              )}
            </div>
          ))}
          {d.options.length < MAX_OPTIONS && (
            <button type="button" onClick={() => set({ options: [...d.options, ''] })} className="text-sm text-accent-ink hover:underline">
              + אפשרות
            </button>
          )}
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={d.multiple}
              onChange={(e) => set({ multiple: e.target.checked, correct: e.target.checked ? d.correct : d.correct.slice(0, 1) })}
              className="h-4 w-4"
            />
            אפשר לבחור כמה תשובות
          </label>
          <p className="text-xs text-ink-3">סימון ✓ ליד אפשרות = תשובה נכונה (לא חובה). היא תוצג לסטודנטים רק כשתציגו את התוצאות.</p>
        </div>
      )}

      {d.type === 'yesno' && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-ink-2">תשובה נכונה (לא חובה):</span>
          {(['yes', 'no'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggleCorrect(c)}
              aria-pressed={d.correct.includes(c)}
              className={`rounded-full px-3 py-1 ring-1 ${d.correct.includes(c) ? 'bg-good-strong text-white ring-good-strong' : 'ring-line-strong'}`}
            >
              {c === 'yes' ? 'כן' : 'לא'}
            </button>
          ))}
        </div>
      )}

      {d.type === 'text' && (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={d.showTextOnScreen} onChange={(e) => set({ showTextOnScreen: e.target.checked })} className="h-4 w-4" />
          להציג את התשובות במסך ההקרנה
        </label>
      )}

      <fieldset className="space-y-1.5 text-sm">
        <legend className="mb-1 font-medium text-ink-2">מי יכול לענות?</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="audience" checked={d.audience === 'roster'} onChange={() => set({ audience: 'roster' })} />
          כל הסטודנטים בקורס
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="audience" checked={d.audience === 'present'} onChange={() => set({ audience: 'present' })} />
          רק מי שנוכח/ת בשיעור (סימן/ה נוכחות במפגש הפתוח)
        </label>
        {presentNeedsSession && <p className="text-xs text-warn">כדי לפתוח סקר כזה צריך שהנוכחות תהיה פתוחה.</p>}
      </fieldset>

      <ErrorBox>{error}</ErrorBox>
      <div className="flex flex-wrap gap-2">
        {submitLabels.open && (
          <button type="submit" disabled={busy || presentNeedsSession} className="btn-primary rounded-full px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50">
            {busy ? '…' : submitLabels.open}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => submit(false)}
          className="rounded-full bg-surface-2 px-4 py-2 text-sm font-medium text-ink ring-1 ring-line hover:bg-surface-3 disabled:opacity-50"
        >
          {submitLabels.save}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-ink-2">
            ביטול
          </button>
        )}
      </div>
    </form>
  );
}
