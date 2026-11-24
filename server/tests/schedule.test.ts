import { describe, expect, it } from 'vitest';
import { buildAgenda, describeEvent, readEvent, readSlots, type Slot } from '../src/lib/schedule';
import { addDays, localNow, weekdayOf } from '../src/lib/time';

const SUN = { id: 's1', weekday: 0, start: '10:00', end: '12:00', title: 'הרצאה', place: '204' } satisfies Slot;
const TUE = { id: 's2', weekday: 2, start: '14:00', end: '15:00', title: 'תרגול', place: '' } satisfies Slot;

describe('time helpers', () => {
  it('local date/time in a time zone, weekdays and date math', () => {
    expect(localNow(new Date('2026-11-22T23:30:00Z'), 'Asia/Jerusalem')).toEqual({ date: '2026-11-23', time: '01:30', weekday: 1 });
    expect(weekdayOf('2026-11-22')).toBe(0); // Sunday
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('readSlots', () => {
  it('sorts slots, keeps ids and gives new ones', () => {
    const r = readSlots([{ weekday: 2, start: '14:00', end: '15:00' }, { id: 'keep', weekday: 0, start: '10:00', end: '12:00', title: ' הרצאה ' }]) as Slot[];
    expect(r.map((s) => [s.weekday, s.id === 'keep', s.title])).toEqual([[0, true, 'הרצאה'], [2, false, '']]);
    expect(r[1].id).toBeTruthy();
  });
  it('rejects bad slots', () => {
    expect(readSlots('x')).toEqual({ error: 'Invalid schedule' });
    expect(readSlots([{ weekday: 7, start: '10:00', end: '11:00' }])).toEqual({ error: 'Invalid schedule' });
    expect(readSlots([{ weekday: 1, start: '12:00', end: '11:00' }])).toEqual({ error: 'Invalid class time' });
    expect(readSlots([{ weekday: 1, start: '25:00', end: '26:00' }])).toEqual({ error: 'Invalid class time' });
  });
});

describe('readEvent', () => {
  it('validates per kind', () => {
    expect(readEvent({ kind: 'office', date: '2026-11-24', start: '14:00', end: '15:00', title: 'שעות קבלה', link: 'https://zoom.us/j/1' }, [])).toMatchObject({ kind: 'office', start: '14:00', end: '15:00' });
    expect(readEvent({ kind: 'extra', date: '2026-11-24', start: '09:00' }, [])).toMatchObject({ kind: 'extra', end: undefined });
    expect(readEvent({ kind: 'meeting', date: '2026-11-24', start: '09:00' }, [])).toEqual({ error: 'Title is required' });
    expect(readEvent({ kind: 'office', date: '2026-02-30', start: '09:00', title: 'x' }, [])).toEqual({ error: 'Invalid date' });
    expect(readEvent({ kind: 'office', date: '2026-11-24', start: '09:00', end: '08:00', title: 'x' }, [])).toEqual({ error: 'Invalid end time' });
    expect(readEvent({ kind: 'office', date: '2026-11-24', start: '09:00', title: 'x', link: 'javascript:alert(1)' }, [])).toEqual({ error: 'Link must start with http:// or https://' });
    expect(readEvent({ kind: 'party', date: '2026-11-24' }, [])).toEqual({ error: 'Invalid event type' });
  });
  it('a cancellation must match a slot on that weekday and copies its time', () => {
    expect(readEvent({ kind: 'cancelled', date: '2026-11-22', slotId: 's1' }, [SUN])).toMatchObject({ slotId: 's1', start: '10:00', end: '12:00' });
    expect(readEvent({ kind: 'cancelled', date: '2026-11-23', slotId: 's1' }, [SUN])).toEqual({ error: 'Choose a class on that day to cancel' });
  });
});

describe('buildAgenda', () => {
  const course = { id: 'c1', name: 'מבוא', schedule: [SUN, TUE] };
  it('repeats weekly slots, adds events, marks cancellations, sorted by time', () => {
    const items = buildAgenda(
      [course],
      [
        { id: 'e1', courseId: 'c1', kind: 'cancelled', date: '2026-11-22', slotId: 's1', start: '10:00', end: '12:00', title: '', place: '', link: '', notes: '' },
        { id: 'e2', courseId: 'c1', kind: 'office', date: '2026-11-22', start: '08:00', title: 'שעות קבלה', place: 'חדר 3', link: '', notes: '' },
        { id: 'e3', courseId: 'other', kind: 'exam', date: '2026-11-22', start: '09:00', title: 'x', place: '', link: '', notes: '' },
      ],
      '2026-11-22',
      7,
    );
    expect(items.map((i) => [i.date, i.start, i.kind, i.cancelled])).toEqual([
      ['2026-11-22', '08:00', 'office', false],
      ['2026-11-22', '10:00', 'class', true],
      ['2026-11-24', '14:00', 'class', false],
    ]);
  });
  it('respects semester dates', () => {
    const items = buildAgenda([{ ...course, semesterStart: '2026-11-23', semesterEnd: '2026-11-30' }], [], '2026-11-22', 14);
    expect(items.map((i) => i.date)).toEqual(['2026-11-24', '2026-11-29']);
  });
});

describe('describeEvent', () => {
  it('reads well in a notification', () => {
    expect(describeEvent({ kind: 'office', date: '2026-11-24', start: '14:00', title: '' })).toBe('יום שלישי 24.11 · 14:00 · שעות קבלה');
  });
});
