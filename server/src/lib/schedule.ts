import { randomUUID } from 'node:crypto';
import { EVENT_KINDS, type EventKind } from '../models/CourseEvent.js';
import { addDays, isDate, isTime, minutes, weekdayOf } from './time.js';

export const SCHEDULE_LIMITS = { maxSlots: 14, titleMax: 60, placeMax: 80, linkMax: 300, notesMax: 300, eventTitleMax: 100 } as const;

export interface Slot {
  id: string;
  weekday: number;
  start: string;
  end: string;
  title: string;
  place: string;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Validates weekly slots; keeps existing ids, gives new slots an id. */
export function readSlots(body: unknown): Slot[] | { error: string } {
  if (!Array.isArray(body)) return { error: 'Invalid schedule' };
  if (body.length > SCHEDULE_LIMITS.maxSlots) return { error: 'Too many weekly slots' };
  const slots: Slot[] = [];
  for (const raw of body) {
    const s = (raw ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(s.weekday) || (s.weekday as number) < 0 || (s.weekday as number) > 6) return { error: 'Invalid schedule' };
    if (!isTime(s.start) || !isTime(s.end) || minutes(s.end) <= minutes(s.start)) return { error: 'Invalid class time' };
    slots.push({
      id: typeof s.id === 'string' && s.id ? s.id.slice(0, 40) : randomUUID(),
      weekday: s.weekday as number,
      start: s.start,
      end: s.end,
      title: text(s.title, SCHEDULE_LIMITS.titleMax),
      place: text(s.place, SCHEDULE_LIMITS.placeMax),
    });
  }
  return slots.sort((a, b) => a.weekday - b.weekday || minutes(a.start) - minutes(b.start));
}

export interface EventInput {
  kind: EventKind;
  date: string;
  start?: string;
  end?: string;
  title: string;
  place: string;
  link: string;
  notes: string;
  slotId?: string;
}

/** Validates a one-off event. `cancelled` needs a slot of this course on that weekday. */
export function readEvent(body: unknown, slots: Slot[]): EventInput | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!EVENT_KINDS.includes(b.kind as EventKind)) return { error: 'Invalid event type' };
  const kind = b.kind as EventKind;
  if (!isDate(b.date)) return { error: 'Invalid date' };
  const link = text(b.link, SCHEDULE_LIMITS.linkMax);
  if (link && !/^https?:\/\//i.test(link)) return { error: 'Link must start with http:// or https://' };
  const base = { kind, date: b.date, title: text(b.title, SCHEDULE_LIMITS.eventTitleMax), place: text(b.place, SCHEDULE_LIMITS.placeMax), link, notes: text(b.notes, SCHEDULE_LIMITS.notesMax) };

  if (kind === 'cancelled') {
    const slot = slots.find((s) => s.id === b.slotId);
    if (!slot || slot.weekday !== weekdayOf(b.date)) return { error: 'Choose a class on that day to cancel' };
    return { ...base, slotId: slot.id, start: slot.start, end: slot.end };
  }
  if (!isTime(b.start)) return { error: 'Invalid start time' };
  if (b.end !== undefined && b.end !== null && b.end !== '' && (!isTime(b.end) || minutes(b.end) <= minutes(b.start))) return { error: 'Invalid end time' };
  if (kind !== 'extra' && !base.title) return { error: 'Title is required' };
  return { ...base, start: b.start, end: isTime(b.end) ? b.end : undefined };
}

export interface AgendaCourse {
  id: string;
  name: string;
  schedule: Slot[];
  semesterStart?: string | null;
  semesterEnd?: string | null;
}

export interface AgendaEvent extends EventInput {
  id: string;
  courseId: string;
}

export interface AgendaItem {
  date: string;
  start: string;
  end: string | null;
  courseId: string;
  courseName: string;
  /** 'class' = a weekly slot; otherwise the event kind. */
  kind: 'class' | Exclude<EventKind, 'cancelled'>;
  title: string;
  place: string;
  link: string;
  notes: string;
  cancelled: boolean;
  slotId?: string;
  eventId?: string;
}

/** Every class and event between `from` and `from + days - 1`, in order. Cancelled classes stay in, flagged. */
export function buildAgenda(courses: AgendaCourse[], events: AgendaEvent[], from: string, days: number): AgendaItem[] {
  const items: AgendaItem[] = [];
  const to = addDays(from, days - 1);
  const cancelled = new Set(events.filter((e) => e.kind === 'cancelled').map((e) => `${e.courseId}|${e.slotId}|${e.date}`));
  const byId = new Map(courses.map((c) => [c.id, c]));

  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const weekday = weekdayOf(date);
    for (const c of courses) {
      if ((c.semesterStart && date < c.semesterStart) || (c.semesterEnd && date > c.semesterEnd)) continue;
      for (const s of c.schedule) {
        if (s.weekday !== weekday) continue;
        items.push({
          date,
          start: s.start,
          end: s.end,
          courseId: c.id,
          courseName: c.name,
          kind: 'class',
          title: s.title,
          place: s.place,
          link: '',
          notes: '',
          cancelled: cancelled.has(`${c.id}|${s.id}|${date}`),
          slotId: s.id,
        });
      }
    }
  }
  for (const e of events) {
    if (e.kind === 'cancelled' || e.date < from || e.date > to) continue;
    const c = byId.get(e.courseId);
    if (!c) continue;
    items.push({
      date: e.date,
      start: e.start ?? '00:00',
      end: e.end ?? null,
      courseId: c.id,
      courseName: c.name,
      kind: e.kind,
      title: e.title,
      place: e.place,
      link: e.link,
      notes: e.notes,
      cancelled: false,
      eventId: e.id,
    });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || minutes(a.start) - minutes(b.start) || a.courseName.localeCompare(b.courseName, 'he'));
}

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const KIND_LABEL: Record<string, string> = { extra: 'שיעור נוסף', office: 'שעות קבלה', meeting: 'פגישה', exam: 'מבחן', other: 'אירוע' };

/** Short Hebrew line for notifications, e.g. "יום שני 25.11 · 10:00 · שעות קבלה". */
export function describeEvent(e: { kind: string; date: string; start?: string | null; title?: string }) {
  const [, m, d] = e.date.split('-');
  const day = `יום ${WEEKDAYS[weekdayOf(e.date)]} ${Number(d)}.${Number(m)}`;
  const what = e.title || KIND_LABEL[e.kind] || '';
  return [day, e.start, what].filter(Boolean).join(' · ');
}
