import { describe, expect, it } from 'vitest';
import { buildStudentRows, isSessionActive, type StatsInput } from '../src/lib/stats';

const NOW = new Date('2026-11-22T10:00:00Z');
const t = (iso: string) => new Date(`2026-11-${iso}Z`);

const roster = [
  { email: 'dana@x.com', firstName: 'דנה', lastName: 'כהן' },
  { email: 'ron@x.com', firstName: 'רון', lastName: 'לוי' },
  { email: 'avi@x.com', firstName: 'אבי', lastName: 'כהן' },
  { email: 'new@x.com', firstName: 'נועה', lastName: 'אזולאי' }, // not signed up
];
const users = [
  { id: 'u-dana', email: 'dana@x.com' },
  { id: 'u-ron', email: 'ron@x.com' },
  { id: 'u-avi', email: 'avi@x.com' },
  { id: 'u-gone', email: 'gone@x.com' }, // removed from roster
];

function input(over: Partial<StatsInput> = {}): StatsInput {
  return { roster, users, sessions: [], attendance: [], now: NOW, ...over };
}

describe('isSessionActive', () => {
  it('is active only while status is active and endsAt is in the future', () => {
    expect(isSessionActive({ status: 'active', endsAt: t('22T10:05:00') }, NOW)).toBe(true);
    expect(isSessionActive({ status: 'active', endsAt: t('22T09:59:59') }, NOW)).toBe(false);
    expect(isSessionActive({ status: 'closed', endsAt: t('22T10:05:00') }, NOW)).toBe(false);
  });
});

describe('buildStudentRows', () => {
  it('lists every roster entry sorted by last name, then first name', () => {
    const rows = buildStudentRows(input());
    expect(rows.map((r) => `${r.lastName} ${r.firstName}`)).toEqual(['אזולאי נועה', 'כהן אבי', 'כהן דנה', 'לוי רון']);
  });

  it('marks who has signed up', () => {
    const rows = buildStudentRows(input());
    expect(rows.find((r) => r.email === 'new@x.com')?.registered).toBe(false);
    expect(rows.find((r) => r.email === 'dana@x.com')?.registered).toBe(true);
  });

  it('with no sessions: 0 of 0, percent null (no division by zero), never seen', () => {
    const dana = buildStudentRows(input()).find((r) => r.email === 'dana@x.com')!;
    expect(dana).toMatchObject({ attended: 0, totalSessions: 0, percent: null, lastSeenAt: null, presentNow: null });
  });

  it('counts attendance (gps and manual alike), percent and last seen', () => {
    const sessions = [
      { id: 's1', status: 'closed', endsAt: t('20T10:15:00') },
      { id: 's2', status: 'closed', endsAt: t('21T10:15:00') },
      { id: 's3', status: 'closed', endsAt: t('21T12:15:00') },
    ];
    const attendance = [
      { sessionId: 's1', studentId: 'u-dana', checkedInAt: t('20T10:02:00') },
      { sessionId: 's2', studentId: 'u-dana', checkedInAt: t('21T10:03:00') },
      { sessionId: 's3', studentId: 'u-ron', checkedInAt: t('21T12:01:00') },
    ];
    const rows = buildStudentRows(input({ sessions, attendance }));
    const dana = rows.find((r) => r.email === 'dana@x.com')!;
    expect(dana).toMatchObject({ attended: 2, totalSessions: 3, percent: 67, lastSeenAt: t('21T10:03:00') });
    expect(rows.find((r) => r.email === 'avi@x.com')).toMatchObject({ attended: 0, percent: 0, lastSeenAt: null });
    expect(rows.find((r) => r.email === 'new@x.com')).toMatchObject({ attended: 0, totalSessions: 3, percent: 0 });
  });

  it('ignores attendance of users no longer on the roster and of other sessions', () => {
    const sessions = [{ id: 's1', status: 'closed', endsAt: t('20T10:15:00') }];
    const attendance = [
      { sessionId: 's1', studentId: 'u-gone', checkedInAt: t('20T10:02:00') },
      { sessionId: 'other-course-session', studentId: 'u-dana', checkedInAt: t('20T10:02:00') },
    ];
    const rows = buildStudentRows(input({ sessions, attendance }));
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.attended === 0)).toBe(true);
  });

  it('presentNow is set only while a session is active', () => {
    const attendance = [{ sessionId: 's-live', studentId: 'u-dana', checkedInAt: t('22T09:58:00') }];
    const live = [{ id: 's-live', status: 'active', endsAt: t('22T10:10:00') }];
    const rows = buildStudentRows(input({ sessions: live, attendance }));
    expect(rows.find((r) => r.email === 'dana@x.com')?.presentNow).toBe(true);
    expect(rows.find((r) => r.email === 'ron@x.com')?.presentNow).toBe(false);

    const expired = [{ id: 's-live', status: 'active', endsAt: t('22T09:59:00') }];
    expect(buildStudentRows(input({ sessions: expired, attendance })).every((r) => r.presentNow === null)).toBe(true);
  });

  it('matches roster to accounts case-insensitively', () => {
    const rows = buildStudentRows(input({ roster: [{ email: 'Dana@X.com', firstName: 'דנה', lastName: 'כהן' }] }));
    expect(rows[0].registered).toBe(true);
  });
});
