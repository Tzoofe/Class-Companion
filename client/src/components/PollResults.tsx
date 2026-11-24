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
          {correct && <span className={`ms-2 font-medium ${large ? 'text-good' : 'text-good'}`}>✓ נכון</span>}
          {mine && <span className={`ms-2 text-ink-3 text-xs`}>(הבחירה שלך)</span>}
        </span>
        <span className="shrink-0 tabular-nums">
          {count} <span className={large ? 'text-ink-4' : 'text-ink-3'}>· {p}%</span>
        </span>
      </div>
      <div className={`mt-1 w-full overflow-hidden rounded-full ${large ? 'h-6 bg-surface-3' : 'h-2.5 bg-surface-2'}`}>
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${correct ? 'bg-good' : 'bg-accent'}`}
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
        <p className={large ? 'text-3xl' : 'text-sm text-ink-2'}>
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
    if (!showTexts) return <p className={large ? 'text-3xl' : 'text-sm text-ink-2'}>{total} תשובות</p>;
    if (!results.texts?.length) return <p className={large ? 'text-2xl text-ink-4' : 'text-sm text-ink-3'}>עוד אין תשובות.</p>;
    return (
      <ul className={large ? 'grid gap-3 lg:grid-cols-2' : 'space-y-1.5'}>
        {results.texts.map((t, i) => (
          <li key={i} className={large ? 'rounded-2xl bg-elevated p-4 text-2xl' : 'rounded-xl bg-surface px-3 py-2 text-sm'}>
            {t}
          </li>
        ))}
      </ul>
    );
  }
  return null;
}
