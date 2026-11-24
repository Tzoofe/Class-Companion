import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, WEEKDAYS_HE, type CourseEvent, type CourseSchedule, type EventKind, type Slot } from '../api';
import { ErrorBox, BackLink } from '../components/ui';

const card = 'space-y-3 card p-4';
const input = 'rounded-xl border border-line-strong bg-surface-2 px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
const smallButton = 'btn-primary rounded-full px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50';

const EVENT_KINDS: [Exclude<EventKind, 'cancelled'>, string][] = [
  ['extra', 'שיעור נוסף'],
  ['office', 'שעות קבלה'],
  ['meeting', 'פגישה'],
  ['exam', 'מבחן'],
  ['other', 'אחר'],
];
const KIND_LABEL: Record<EventKind, string> = { extra: 'שיעור נוסף', office: 'שעות קבלה', meeting: 'פגישה', exam: 'מבחן', other: 'אירוע', cancelled: 'ביטול שיעור' };

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const fmtDate = (date: string) => {
  const [, m, d] = date.split('-').map(Number);
  return `יום ${WEEKDAYS_HE[weekdayOf(date)]} ${d}.${m}`;
};

function WeeklySlots({ data, onSaved }: { data: CourseSchedule; onSaved: (d: Partial<CourseSchedule>) => void }) {
  const [slots, setSlots] = useState<Slot[]>(data.schedule);
  const [start, setStart] = useState(data.semesterStart ?? '');
  const [end, setEnd] = useState(data.semesterEnd ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const set = (i: number, patch: Partial<Slot>) => {
    setSaved(false);
    setSlots((xs) => xs.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<Pick<CourseSchedule, 'schedule' | 'semesterStart' | 'semesterEnd'>>(`/courses/${data.course.id}/schedule`, {
        method: 'PUT',
        json: { schedule: slots, semesterStart: start || null, semesterEnd: end || null },
      });
      setSlots(r.schedule);
      onSaved(r);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className={card}>
      <h2 className="">שיעורים קבועים בכל שבוע</h2>
      {slots.length === 0 && <p className="text-sm text-ink-3">עוד לא הוגדרו שיעורים. הוסיפו את הזמנים הקבועים של הקורס.</p>}
      <ul className="space-y-3">
        {slots.map((s, i) => (
          <li key={s.id ?? `new-${i}`} className="grid grid-cols-2 gap-2 rounded-xl bg-surface p-3 sm:grid-cols-[8rem_6rem_6rem_1fr_1fr_auto] sm:items-center">
            <select value={s.weekday} onChange={(e) => set(i, { weekday: Number(e.target.value) })} className={input} aria-label="יום">
              {WEEKDAYS_HE.map((d, n) => (
                <option key={n} value={n}>
                  יום {d}
                </option>
              ))}
            </select>
            <div className="col-span-1 flex items-center gap-1 sm:contents">
              <input type="time" value={s.start} onChange={(e) => set(i, { start: e.target.value })} className={`${input} w-full`} aria-label="התחלה" required />
              <input type="time" value={s.end} onChange={(e) => set(i, { end: e.target.value })} className={`${input} w-full`} aria-label="סיום" required />
            </div>
            <input value={s.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="סוג (הרצאה / תרגול)" className={input} />
            <input value={s.place} onChange={(e) => set(i, { place: e.target.value })} placeholder="מקום (חדר 204)" className={input} />
            <button type="button" onClick={() => setSlots((xs) => xs.filter((_, j) => j !== i))} className="justify-self-start text-sm text-bad hover:underline">
              הסרה
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setSlots((xs) => [...xs, { weekday: 0, start: '10:00', end: '12:00', title: '', place: '' }])}
        className="text-sm font-medium text-accent-ink hover:underline"
      >
        + שיעור שבועי
      </button>
      <div className="grid gap-2 border-t border-line pt-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-ink-2">תחילת הסמסטר (לא חובה)</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`${input} w-full`} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-2">סוף הסמסטר (לא חובה)</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={`${input} w-full`} />
        </label>
      </div>
      <p className="text-xs text-ink-3">סטודנטים יקבלו התראה כששעות השיעורים משתנות.</p>
      <ErrorBox>{error}</ErrorBox>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={smallButton}>
          {busy ? '…' : 'שמירה'}
        </button>
        {saved && <span className="text-sm text-good">✓ נשמר</span>}
      </div>
    </form>
  );
}

type EventForm = { kind: Exclude<EventKind, 'cancelled'>; date: string; start: string; end: string; title: string; place: string; link: string; notes: string };
const blankEvent = (date: string): EventForm => ({ kind: 'office', date, start: '10:00', end: '', title: '', place: '', link: '', notes: '' });

function EventEditor({ courseId, initial, eventId, onSaved, onCancel }: { courseId: string; initial: EventForm; eventId?: string; onSaved: (e: CourseEvent) => void; onCancel: () => void }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<EventForm>) => setF((x) => ({ ...x, ...patch }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ event: CourseEvent }>(eventId ? `/events/${eventId}` : `/courses/${courseId}/events`, { method: eventId ? 'PUT' : 'POST', json: f });
      onSaved(r.event);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl bg-surface p-3">
      <div className="flex flex-wrap gap-1 rounded-xl bg-surface-2 p-0.5 text-sm ring-1 ring-line">
        {EVENT_KINDS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => set({ kind: k })} className={`flex-1 rounded-md px-2 py-1 ${f.kind === k ? 'bg-accent text-white' : 'text-ink-2'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} className={input} required aria-label="תאריך" />
        <input type="time" value={f.start} onChange={(e) => set({ start: e.target.value })} className={input} required aria-label="התחלה" />
        <input type="time" value={f.end} onChange={(e) => set({ end: e.target.value })} className={input} aria-label="סיום (לא חובה)" />
      </div>
      <input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder={f.kind === 'extra' ? 'כותרת (לא חובה)' : 'כותרת'} className={`${input} w-full`} required={f.kind !== 'extra'} />
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={f.place} onChange={(e) => set({ place: e.target.value })} placeholder="מקום" className={input} />
        <input value={f.link} onChange={(e) => set({ link: e.target.value })} placeholder="קישור (זום וכו׳)" dir="ltr" className={input} />
      </div>
      <input value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="הערה (לא חובה)" className={`${input} w-full`} />
      <ErrorBox>{error}</ErrorBox>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={smallButton}>
          {busy ? '…' : eventId ? 'שמירה' : 'הוספה'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 text-sm text-ink-2">
          ביטול
        </button>
      </div>
      <p className="text-xs text-ink-3">הסטודנטים בקורס יקבלו התראה.</p>
    </form>
  );
}

/** Upcoming occurrences of the weekly slots (next 3 weeks), for "cancel a class". */
function upcomingClasses(data: CourseSchedule) {
  const out: { date: string; slot: Slot }[] = [];
  for (let i = 0; i < 21; i++) {
    const d = new Date(`${data.today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    if ((data.semesterStart && date < data.semesterStart) || (data.semesterEnd && date > data.semesterEnd)) continue;
    for (const slot of data.schedule) if (slot.weekday === d.getUTCDay()) out.push({ date, slot });
  }
  return out;
}

function Events({ data, onChange }: { data: CourseSchedule; onChange: (events: CourseEvent[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [cancelKey, setCancelKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const cancelled = new Set(data.events.filter((e) => e.kind === 'cancelled').map((e) => `${e.date}|${e.slotId}`));
  const classes = useMemo(() => upcomingClasses(data).filter((c) => !cancelled.has(`${c.date}|${c.slot.id}`)), [data]);
  const upcoming = data.events.filter((e) => e.date >= data.today);
  const past = data.events.filter((e) => e.date < data.today);

  async function cancelClass() {
    const [date, slotId] = cancelKey.split('|');
    if (!date) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ event: CourseEvent }>(`/courses/${data.course.id}/events`, { method: 'POST', json: { kind: 'cancelled', date, slotId } });
      onChange([...data.events, r.event].sort((a, b) => a.date.localeCompare(b.date)));
      setCancelKey('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(ev: CourseEvent) {
    const msg = ev.kind === 'cancelled' ? 'לבטל את הביטול? השיעור יתקיים כרגיל והסטודנטים יקבלו התראה.' : 'למחוק את האירוע? הסטודנטים יקבלו התראה.';
    if (!window.confirm(msg)) return;
    setError('');
    try {
      await api(`/events/${ev.id}`, { method: 'DELETE' });
      onChange(data.events.filter((x) => x.id !== ev.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const saved = (e: CourseEvent) => {
    onChange([...data.events.filter((x) => x.id !== e.id), e].sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? '')));
    setAdding(false);
    setEditing(null);
  };

  const row = (ev: CourseEvent) =>
    editing === ev.id ? (
      <li key={ev.id} className="py-2">
        <EventEditor
          courseId={data.course.id}
          eventId={ev.id}
          initial={{ kind: ev.kind === 'cancelled' ? 'other' : ev.kind, date: ev.date, start: ev.start ?? '10:00', end: ev.end ?? '', title: ev.title, place: ev.place, link: ev.link, notes: ev.notes }}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      </li>
    ) : (
      <li key={ev.id} className="flex items-start justify-between gap-3 py-2.5">
        <div className="min-w-0 text-sm">
          <div className="font-medium">
            {fmtDate(ev.date)} · <span dir="ltr">{ev.start}{ev.end && `–${ev.end}`}</span>
          </div>
          <div className={ev.kind === 'cancelled' ? 'text-bad' : 'text-ink-2'}>
            {ev.kind === 'cancelled' ? `✕ ${KIND_LABEL.cancelled}` : `${KIND_LABEL[ev.kind]}${ev.title ? ` · ${ev.title}` : ''}`}
            {ev.place && `, ${ev.place}`}
          </div>
        </div>
        <span className="flex shrink-0 gap-3 text-sm">
          {ev.kind !== 'cancelled' && (
            <button type="button" onClick={() => setEditing(ev.id)} className="text-accent-ink hover:underline">
              עריכה
            </button>
          )}
          <button type="button" onClick={() => remove(ev)} className="text-bad hover:underline">
            {ev.kind === 'cancelled' ? 'ביטול הביטול' : 'מחיקה'}
          </button>
        </span>
      </li>
    );

  return (
    <section className={card}>
      <h2 className="">אירועים חד-פעמיים</h2>

      {classes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bad-soft p-3 text-sm">
          <span className="font-medium text-bad">ביטול שיעור:</span>
          <select value={cancelKey} onChange={(e) => setCancelKey(e.target.value)} className={`${input} min-w-0 flex-1`}>
            <option value="">בחרו שיעור…</option>
            {classes.map((c) => (
              <option key={`${c.date}|${c.slot.id}`} value={`${c.date}|${c.slot.id}`}>
                {fmtDate(c.date)} · {c.slot.start}
                {c.slot.title && ` · ${c.slot.title}`}
              </option>
            ))}
          </select>
          <button type="button" disabled={!cancelKey || busy} onClick={cancelClass} className="rounded-xl bg-bad px-3 py-2 font-medium text-white disabled:opacity-50">
            ביטול השיעור
          </button>
        </div>
      )}

      {adding ? (
        <EventEditor courseId={data.course.id} initial={blankEvent(data.today)} onSaved={saved} onCancel={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="text-sm font-medium text-accent-ink hover:underline">
          + שיעור נוסף / שעות קבלה / פגישה / מבחן
        </button>
      )}
      <ErrorBox>{error}</ErrorBox>

      {upcoming.length > 0 ? <ul className="divide-y divide-line">{upcoming.map(row)}</ul> : !adding && <p className="text-sm text-ink-3">אין אירועים קרובים.</p>}
      {past.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-ink-3">אירועים שעברו ({past.length})</summary>
          <ul className="divide-y divide-line opacity-70">{past.map(row)}</ul>
        </details>
      )}
    </section>
  );
}

/** Lecturer: weekly class times, semester dates and one-off events of a course. */
export default function CourseSchedulePage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<CourseSchedule | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<CourseSchedule>(`/courses/${id}/schedule`).then(setData, (e) => setError(e.message));
  }, [id]);

  if (!data) return error ? <ErrorBox>{error}</ErrorBox> : <p className="text-ink-3">טוען…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <BackLink to={`/courses/${id}`}>{data.course.name}</BackLink>
        <h1 className="mt-1 text-xl">לוח זמנים</h1>
        <p className="text-sm text-ink-3">השיעורים והאירועים מופיעים ב"היום" שלך ושל הסטודנטים בקורס.</p>
      </div>
      <WeeklySlots data={data} onSaved={(r) => setData((d) => d && { ...d, ...r })} />
      <Events data={data} onChange={(events) => setData((d) => d && { ...d, events })} />
    </div>
  );
}
