import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { WEEKDAYS_HE, type Agenda, type AgendaItem } from '../api';
import { IconPin } from './icons';

export const KIND_HE: Record<AgendaItem['kind'], string> = {
  class: 'שיעור',
  extra: 'שיעור נוסף',
  office: 'שעות קבלה',
  meeting: 'פגישה',
  exam: 'מבחן',
  other: 'אירוע',
};

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function dayLabel(date: string, today: string) {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = WEEKDAYS_HE[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const diff = Math.round((Date.UTC(y, m - 1, d) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
  const rel = diff === 0 ? 'היום' : diff === 1 ? 'מחר' : `יום ${weekday}`;
  return `${rel} · ${diff <= 1 ? `יום ${weekday} ` : ''}${d}.${m}`;
}

/** now / soon (≤ 30 min) / past / later, for an item on today's date. */
export function timing(item: AgendaItem, now: Agenda['now']): 'now' | 'soon' | 'past' | 'later' {
  if (item.date !== now.date) return item.date < now.date ? 'past' : 'later';
  const t = toMin(now.time);
  const start = toMin(item.start);
  const end = item.end ? toMin(item.end) : start + 60;
  if (t >= start && t < end) return 'now';
  if (t >= end) return 'past';
  return start - t <= 30 ? 'soon' : 'later';
}

function ItemRow({ item, now, action, showCourse }: { item: AgendaItem; now: Agenda['now']; action?: ReactNode; showCourse: boolean }) {
  const t = timing(item, now);
  const label = item.kind === 'class' ? item.title || KIND_HE.class : item.title || KIND_HE[item.kind];
  return (
    <li className={`flex items-start gap-3 px-4 py-3 ${t === 'now' && !item.cancelled ? 'bg-good-soft' : ''} ${t === 'past' ? 'opacity-60' : ''}`}>
      <div className="w-24 shrink-0 text-sm tabular-nums text-ink-2" dir="ltr">
        {item.start}
        {item.end && `–${item.end}`}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`font-medium ${item.cancelled ? 'text-ink-4 line-through' : ''}`}>
          {showCourse && <span>{item.courseName}</span>}
          {showCourse && label && <span className="text-ink-3"> · </span>}
          <span className={showCourse ? 'font-normal text-ink-2' : ''}>{label}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
          {item.cancelled && <span className="rounded bg-bad-soft px-1.5 py-0.5 font-medium text-bad">✕ בוטל</span>}
          {!item.cancelled && t === 'now' && <span className="rounded bg-good-soft px-1.5 py-0.5 font-medium text-good">● עכשיו</span>}
          {!item.cancelled && t === 'soon' && <span className="rounded bg-warn-soft px-1.5 py-0.5 text-warn">בקרוב</span>}
          {item.kind !== 'class' && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent-ink">{KIND_HE[item.kind]}</span>}
          {item.place && <span className="inline-flex items-center gap-1"><IconPin />{item.place}</span>}
          {item.link && (
            <a href={item.link} target="_blank" rel="noreferrer" className="text-accent-ink underline">
              קישור
            </a>
          )}
          {item.notes && <span>{item.notes}</span>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  );
}

/** Agenda grouped by day. `action` can add a button per item (e.g. "start attendance"). */
export default function AgendaList({
  agenda,
  showCourse = true,
  action,
  empty,
}: {
  agenda: Agenda;
  showCourse?: boolean;
  action?: (item: AgendaItem) => ReactNode;
  empty?: ReactNode;
}) {
  const byDay = new Map<string, AgendaItem[]>();
  for (const item of agenda.items) byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);
  if (byDay.size === 0) return <>{empty}</>;
  return (
    <div className="space-y-3">
      {[...byDay].map(([date, items]) => (
        <section key={date} className="overflow-hidden card">
          <h3 className={`border-b border-line px-4 py-2 text-sm ${date === agenda.now.date ? 'bg-accent-soft text-accent-ink' : 'bg-surface text-ink-2'}`}>
            {dayLabel(date, agenda.now.date)}
          </h3>
          <ul className="divide-y divide-line">
            {items.map((item, i) => (
              <ItemRow key={`${item.courseId}-${item.slotId ?? item.eventId}-${i}`} item={item} now={agenda.now} showCourse={showCourse} action={action?.(item)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function LinkButton({ to, children, tone = 'primary' }: { to: string; children: ReactNode; tone?: 'primary' | 'live' }) {
  return (
    <Link
      to={to}
      className={`inline-block rounded-full px-3.5 py-1.5 text-sm font-medium text-white transition hover:brightness-110 ${tone === 'live' ? 'bg-good-strong' : 'btn-primary'}`}
    >
      {children}
    </Link>
  );
}
