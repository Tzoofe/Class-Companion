import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Bento grid: 2 columns on phones, 4 on desktop, generous gaps.
 * Keep it to a few tiles per screen, each with one job; actions and settings live in the page header.
 */
export function Bento({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-flow-row-dense grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-5 ${className}`}>{children}</div>;
}

/** Column/row spans per size, phone → desktop. */
const SIZE = {
  /** 1×1 on desktop, half width on phones. */
  sm: 'col-span-1',
  /** Full width on phones, 1×1 on desktop: list items such as course tiles. */
  item: 'col-span-2 lg:col-span-1',
  /** 2×1. */
  wide: 'col-span-2',
  /** 1×2 on desktop (full width on phones). */
  tall: 'col-span-2 lg:col-span-1 lg:row-span-2',
  /** 2×2. */
  lg: 'col-span-2 lg:row-span-2',
  /** Full row. */
  full: 'col-span-2 lg:col-span-4',
} as const;

export type TileSize = keyof typeof SIZE;

/**
 * One tile. Three levels of emphasis: `hero` (tinted, one per screen), `plain` (surface), and plain rows
 * inside tiles. `title` is a real heading; `action` is a quiet text link at the other end.
 * With `to`, the whole tile is a link (don't put other links inside it then).
 */
export function Tile({
  size = 'sm',
  title,
  icon,
  action,
  to,
  tone = 'plain',
  className = '',
  children,
}: {
  size?: TileSize;
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  to?: string;
  tone?: 'plain' | 'hero' | 'accent';
  className?: string;
  children: ReactNode;
}) {
  const hero = tone === 'hero' || tone === 'accent';
  const body = (
    <>
      {(title || action) && (
        <div className="mb-4 flex items-baseline justify-between gap-3">
          {title && (
            <h2 className={`flex min-w-0 items-center gap-2 ${hero ? 'text-xl' : 'text-lg'}`}>
              {icon && <span className="shrink-0 text-base">{icon}</span>}
              <span className="truncate">{title}</span>
            </h2>
          )}
          {action && <span className="shrink-0 text-sm text-ink-3">{action}</span>}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </>
  );
  const cls = `${hero ? 'tile-hero' : 'tile'} flex flex-col p-6 ${SIZE[size]} ${className}`;
  return to ? (
    <Link to={to} className={`${cls} transition-[filter] hover:brightness-110`}>
      {body}
    </Link>
  ) : (
    <section className={cls}>{body}</section>
  );
}

/** Big number with a quiet caption. */
export function Figure({ value, caption }: { value: ReactNode; caption?: ReactNode }) {
  return (
    <div className="mt-auto">
      <p className="font-display text-4xl leading-none tabular-nums">{value}</p>
      {caption && <p className="mt-2 text-sm text-ink-3">{caption}</p>}
    </div>
  );
}

/** Quiet underlined text link used for tile actions. */
export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-ink-3">
      {children}
    </Link>
  );
}
