import type { GradeStats } from '../api';

/**
 * Anonymous grade distribution: one bar per 10% of the scale. The viewer's own bar is the accent color
 * (and labeled), the rest are muted. Hover/focus a bar for its range and count.
 */
export default function GradeChart({ stats, maxPoints, mine }: { stats: GradeStats; maxPoints: number; mine?: number | null }) {
  const top = Math.max(...stats.bins, 1);
  const myBin = mine === null || mine === undefined ? -1 : Math.min(9, Math.floor(mine / stats.binWidth));
  const fmt = (n: number) => String(Math.round(n * 10) / 10);
  return (
    <figure className="space-y-3">
      <div className="flex h-32 items-end gap-[2px]" role="list" aria-label={`התפלגות ציונים של ${stats.count} סטודנטים`} dir="ltr">
        {stats.bins.map((count, i) => {
          const from = i * stats.binWidth;
          const to = i === 9 ? maxPoints : (i + 1) * stats.binWidth;
          const label = `${fmt(from)}–${fmt(to)}: ${count} סטודנטים${i === myBin ? ' (כולל אותך)' : ''}`;
          return (
            <div key={i} role="listitem" tabIndex={0} aria-label={label} title={label} className="group relative flex h-full flex-1 items-end outline-none">
              <div
                className={`w-full rounded-t-[4px] transition-colors ${i === myBin ? 'bg-accent' : 'bg-surface-3 group-hover:bg-ink-4 group-focus-visible:bg-ink-4'}`}
                style={{ height: count ? `${Math.max(4, (count / top) * 100)}%` : '0' }}
              />
              {i === myBin && <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-accent-ink">את/ה</span>}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between border-t border-line pt-1 text-xs text-ink-3" dir="ltr">
        <span>0</span>
        <span>{maxPoints}</span>
      </div>
      <figcaption className="text-sm text-ink-2">
        ממוצע {fmt(stats.mean)}, חציון {fmt(stats.median)}, {stats.count} סטודנטים קיבלו ציון.
      </figcaption>
    </figure>
  );
}
