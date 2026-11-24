import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { WEEKDAYS_HE, type Agenda, type AgendaItem } from '../api';

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
    <li className={`flex items-start gap-3 px-4 py-3 ${t === 'now' && !item.cancelled ? 'bg-emerald-50' : ''} ${t === 'past' ? 'opacity-60' : ''}`}>
      <div className="w-24 shrink-0 text-sm tabular-nums text-slate-600" dir="ltr">
        {item.start}
        {item.end && `–${item.end}`}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`font-medium ${item.cancelled ? 'text-slate-400 line-through' : ''}`}>
          {showCourse && <span>{item.courseName}</span>}
          {showCourse && label && <span className="text-slate-500"> · </span>}
          <span className={showCourse ? 'font-normal text-slate-700' : ''}>{label}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          {item.cancelled && <span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700">✕ בוטל</span>}
          {!item.cancelled && t === 'now' && <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">● עכשיו</span>}
          {!item.cancelled && t === 'soon' && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">בקרוב</span>}
          {item.kind !== 'class' && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700">{KIND_HE[item.kind]}</span>}
          {item.place && <span>📍 {item.place}</span>}
          {item.link && (
            <a href={item.link} target="_blank" rel="noreferrer" className="text-indigo-700 underline">
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
        <section key={date} className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <h3 className={`border-b border-slate-100 px-4 py-2 text-sm font-semibold ${date === agenda.now.date ? 'bg-indigo-50 text-indigo-900' : 'bg-slate-50 text-slate-700'}`}>
            {dayLabel(date, agenda.now.date)}
          </h3>
          <ul className="divide-y divide-slate-100">
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
      className={`inline-block rounded-lg px-3 py-1.5 text-sm font-medium text-white ${tone === 'live' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
    >
      {children}
    </Link>
  );
}
