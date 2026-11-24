/**
 * The class at a glance: one dot per student on the roster.
 * Filled violet = checked in by GPS, amber = marked by the lecturer, hollow = absent.
 * Dots fill in place as people check in (the only ambient motion in the app; off with reduced motion).
 */
const MAX_DOTS = 160;

export default function DotGrid({
  present,
  manual = 0,
  total,
  size = 'md',
  label,
}: {
  present: number;
  /** How many of `present` were marked by the lecturer. */
  manual?: number;
  total: number;
  size?: 'sm' | 'md' | 'lg';
  /** Overrides the screen-reader summary. */
  label?: string;
}) {
  const shown = Math.min(total, MAX_DOTS);
  const gps = Math.max(0, present - manual);
  const dot = { sm: 'h-2 w-2', md: 'h-2.5 w-2.5', lg: 'h-4 w-4' }[size];
  const gap = { sm: 'gap-1', md: 'gap-1.5', lg: 'gap-2' }[size];
  const summary = label ?? `${present} מתוך ${total} נוכחים${manual ? `, ${manual} סומנו ידנית` : ''}`;

  return (
    <div role="img" aria-label={summary} className={`flex flex-wrap ${gap}`}>
      {Array.from({ length: shown }, (_, i) => {
        const kind = i < gps ? 'gps' : i < present ? 'manual' : 'absent';
        return (
          <span
            key={i}
            className={`${dot} rounded-full motion-safe:transition-colors motion-safe:duration-500 ${
              kind === 'gps' ? 'bg-accent' : kind === 'manual' ? 'bg-warn' : 'ring-[1.5px] ring-inset ring-absent'
            }`}
          />
        );
      })}
      {total > MAX_DOTS && <span className="text-xs text-ink-3">+{total - MAX_DOTS}</span>}
    </div>
  );
}

/** Small legend, shown once per screen next to the main grid. */
export function DotLegend({ withManual = true }: { withManual?: boolean }) {
  const item = (cls: string, text: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${cls}`} />
      {text}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
      {item('bg-accent', 'נוכח/ת')}
      {withManual && item('bg-warn', 'סומן/ה ידנית')}
      {item('ring-[1.5px] ring-inset ring-absent', 'לא נוכח/ת')}
    </div>
  );
}
