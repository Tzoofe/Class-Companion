import type { InputHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { IconChevron } from './icons';

export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-2">{label}</span>
      <input
        {...props}
        className="w-full rounded-xl border border-line-strong bg-surface-2 px-3 py-2.5 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      />
    </label>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{children}</p>;
}

/** Full-width primary action: the glowing violet pill. */
export const primaryButton =
  'btn-primary w-full rounded-full px-5 py-3.5 font-medium text-white transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50';

/** Compact primary pill. */
export const pillButton = 'btn-primary inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50';

/** Compact secondary (glass) pill. */
export const ghostButton =
  'inline-flex items-center justify-center gap-1.5 rounded-full bg-surface-2 px-4 py-2 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-surface-3 disabled:opacity-50';

/** On/off setting with a title and an explanation of what it changes. */
export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-3">{hint}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span className="h-6 w-11 rounded-full bg-surface-3 transition-colors peer-checked:bg-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
        <span className="absolute start-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:-translate-x-5" />
      </span>
    </label>
  );
}

/** "Back to …" link. In RTL "back" points right, so the chevron is flipped. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
      <IconChevron className="rotate-180" />
      {children}
    </Link>
  );
}
