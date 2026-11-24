import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Bento grid: 2 columns on phones, 4 on desktop. Tile size carries importance —
 * one large tile per screen, a few medium ones, the rest small.
 */
export function Bento({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-flow-row-dense grid-cols-2 gap-3 lg:grid-cols-4 lg:auto-rows-[minmax(9.5rem,auto)] ${className}`}>{children}</div>;
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
  /** 2×2: the hero tile. */
  lg: 'col-span-2 lg:row-span-2',
  /** Full row. */
  full: 'col-span-2 lg:col-span-4',
} as const;

export type TileSize = keyof typeof SIZE;

/**
 * One tile. `title` sits at the top as a quiet label with an optional icon; `action` at the other end.
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
  /** 'accent': the one highlighted tile on a screen. */
  tone?: 'plain' | 'accent';
  className?: string;
  children: ReactNode;
}) {
  const body = (
    <>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && (
            <span className={`flex min-w-0 items-center gap-2 text-sm ${tone === 'accent' ? 'text-accent-ink' : 'text-ink-3'}`}>
              {icon && <span className="shrink-0 text-base">{icon}</span>}
              <span className="truncate">{title}</span>
            </span>
          )}
          {action && <span className="shrink-0 text-sm">{action}</span>}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </>
  );
  const cls = `card flex flex-col p-5 ${SIZE[size]} ${tone === 'accent' ? '!bg-accent-soft' : ''} ${className}`;
  return to ? (
    <Link to={to} className={`${cls} transition-colors hover:bg-surface-2`}>
      {body}
    </Link>
  ) : (
    <section className={cls}>{body}</section>
  );
}

/** Big number with a quiet unit/caption, for small tiles. */
export function Figure({ value, caption }: { value: ReactNode; caption?: ReactNode }) {
  return (
    <div className="mt-auto">
      <p className="font-display text-4xl leading-none tabular-nums">{value}</p>
      {caption && <p className="mt-2 text-sm text-ink-3">{caption}</p>}
    </div>
  );
}
