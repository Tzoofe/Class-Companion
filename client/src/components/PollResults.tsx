import type { PollResults as Results } from '../api';

interface Props {
  type: string;
  options: { id: string; text: string }[];
  results: Results;
  correctOptionIds?: string[];
  /** Answers the viewer chose (highlighted). */
  mine?: { optionIds?: string[]; value?: number };
  /** Projector size. */
  large?: boolean;
  /** Text polls: list the answers. */
  showTexts?: boolean;
}

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

function Bar({ label, count, total, correct, mine, large }: { label: string; count: number; total: number; correct?: boolean; mine?: boolean; large?: boolean }) {
  const p = pct(count, total);
  return (
    <li>
      <div className={`flex items-baseline justify-between gap-3 ${large ? 'text-2xl lg:text-3xl' : 'text-sm'}`}>
        <span className="min-w-0 break-words">
          {label}
          {correct && <span className={`ms-2 font-medium ${large ? 'text-emerald-300' : 'text-emerald-700'}`}>✓ נכון</span>}
          {mine && <span className={`ms-2 ${large ? 'text-slate-300' : 'text-slate-500'} text-xs`}>(הבחירה שלך)</span>}
        </span>
        <span className="shrink-0 tabular-nums">
          {count} <span className={large ? 'text-slate-400' : 'text-slate-500'}>· {p}%</span>
        </span>
      </div>
      <div className={`mt-1 w-full overflow-hidden rounded-full ${large ? 'h-6 bg-slate-700' : 'h-2.5 bg-slate-100'}`}>
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${correct ? 'bg-emerald-500' : large ? 'bg-indigo-400' : 'bg-indigo-500'}`}
          style={{ width: `${p}%` }}
        />
      </div>
    </li>
  );
}

/** Bars for choice / yes-no / scale polls, or the list of text answers. */
export default function PollResults({ type, options, results, correctOptionIds = [], mine, large, showTexts = true }: Props) {
  const total = results.responses;
  if (results.counts) {
    // Multi-select: percentages are of respondents, so they can add up to more than 100%.
    return (
      <ul className={large ? 'space-y-5' : 'space-y-2.5'}>
        {options.map((o) => (
          <Bar
            key={o.id}
            label={o.text}
            count={results.counts![o.id] ?? 0}
            total={total}
            correct={correctOptionIds.includes(o.id)}
            mine={mine?.optionIds?.includes(o.id)}
            large={large}
          />
        ))}
      </ul>
    );
  }
  if (results.scale) {
    return (
      <div className={large ? 'space-y-5' : 'space-y-2.5'}>
        <p className={large ? 'text-3xl' : 'text-sm text-slate-600'}>
          ממוצע: <strong className="tabular-nums">{results.scale.average ?? '—'}</strong> / 5
        </p>
        <ul className={large ? 'space-y-4' : 'space-y-2'}>
          {results.scale.counts.map((c, i) => (
            <Bar key={i} label={String(i + 1)} count={c} total={total} mine={mine?.value === i + 1} large={large} />
          ))}
        </ul>
      </div>
    );
  }
  if (type === 'text') {
    if (!showTexts) return <p className={large ? 'text-3xl' : 'text-sm text-slate-600'}>{total} תשובות</p>;
    if (!results.texts?.length) return <p className={large ? 'text-2xl text-slate-400' : 'text-sm text-slate-500'}>עוד אין תשובות.</p>;
    return (
      <ul className={large ? 'grid gap-3 lg:grid-cols-2' : 'space-y-1.5'}>
        {results.texts.map((t, i) => (
          <li key={i} className={large ? 'rounded-xl bg-slate-800 p-4 text-2xl' : 'rounded-lg bg-slate-50 px-3 py-2 text-sm'}>
            {t}
          </li>
        ))}
      </ul>
    );
  }
  return null;
}
