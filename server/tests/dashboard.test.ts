import { describe, expect, it } from 'vitest';
import { buildDashboard, DASHBOARD, type DashboardInput } from '../src/lib/stats';

const NOW = new Date('2026-11-22T10:00:00Z');
const at = (day: number, hour = 8) => new Date(Date.UTC(2026, 10, day, hour));

const roster = [
  { email: 'dana@x.com', firstName: 'דנה', lastName: 'כהן' },
  { email: 'ron@x.com', firstName: 'רון', lastName: 'לוי' },
  { email: 'avi@x.com', firstName: 'אבי', lastName: 'אבן' },
  { email: 'new@x.com', firstName: 'נועה', lastName: 'אזולאי' }, // not signed up
];
const users = [
  { id: 'u-dana', email: 'Dana@x.com' },
  { id: 'u-ron', email: 'ron@x.com' },
  { id: 'u-avi', email: 'avi@x.com' },
];
const closed = (id: string, day: number) => ({ id, status: 'closed', startsAt: at(day), endsAt: at(day, 9) });
const input = (over: Partial<DashboardInput> = {}): DashboardInput => ({ roster, users, sessions: [], attendance: [], now: NOW, ...over });
const att = (sessionId: string, ...students: string[]) => students.map((studentId) => ({ sessionId, studentId }));

describe('buildDashboard', () => {
  it('handles a course with no sessions', () => {
    const d = buildDashboard(input());
    expect(d).toMatchObject({ rosterCount: 4, registeredCount: 3, sessionCount: 0, finishedSessionCount: 0, averagePercent: null, lastSession: null, live: null, history: [], atRisk: [] });
  });

  it('computes the average over finished sessions and orders history by start time', () => {
    const d = buildDashboard(
      input({
        sessions: [closed('s2', 15), closed('s1', 8)],
        attendance: [...att('s1', 'u-dana', 'u-ron', 'u-avi'), ...att('s2', 'u-dana')],
      }),
    );
    expect(d.history.map((h) => [h.id, h.present])).toEqual([['s1', 3], ['s2', 1]]);
    expect(d.lastSession).toMatchObject({ id: 's2', present: 1 });
    expect(d.averagePercent).toBe(50); // 4 check-ins / (2 sessions × 4 students)
  });

  it('keeps the live session out of rates and at-risk, but reports its count', () => {
    const live = { id: 'live', status: 'active', startsAt: at(22, 9), endsAt: at(22, 11) };
    const d = buildDashboard(
      input({
        sessions: [closed('s1', 8), live],
        attendance: [...att('s1', 'u-dana', 'u-ron', 'u-avi', 'u-gone'), ...att('live', 'u-dana')],
      }),
    );
    expect(d.live).toMatchObject({ id: 'live', present: 1 });
    expect(d.sessionCount).toBe(2);
    expect(d.finishedSessionCount).toBe(1);
    expect(d.history.map((h) => h.id)).toEqual(['s1']);
    expect(d.atRisk.map((s) => s.email)).toEqual(['new@x.com']);
  });

  it('treats an "active" session past its end time as finished', () => {
    const stale = { id: 'old', status: 'active', startsAt: at(21), endsAt: at(21, 9) };
    const d = buildDashboard(input({ sessions: [stale] }));
    expect(d.live).toBeNull();
    expect(d.finishedSessionCount).toBe(1);
  });

  it(`lists students below ${DASHBOARD.atRiskPercent}%, lowest first, at most ${DASHBOARD.atRiskLimit}`, () => {
    const d = buildDashboard(
      input({
        sessions: [closed('s1', 1), closed('s2', 8), closed('s3', 15)],
        attendance: [...att('s1', 'u-dana', 'u-ron', 'u-avi'), ...att('s2', 'u-dana', 'u-ron'), ...att('s3', 'u-dana')],
      }),
    );
    // dana 100%, ron 67%, avi 33%, new 0%
    expect(d.atRisk.map((s) => [s.email, s.percent])).toEqual([['new@x.com', 0], ['avi@x.com', 33], ['ron@x.com', 67]]);

    const many = Array.from({ length: 8 }, (_, i) => ({ email: `s${i}@x.com`, firstName: 'א', lastName: `ב${i}` }));
    expect(buildDashboard(input({ roster: many, sessions: [closed('s1', 1)] })).atRisk).toHaveLength(DASHBOARD.atRiskLimit);
  });

  it(`shows only the last ${DASHBOARD.chartSessions} sessions in the chart`, () => {
    const sessions = Array.from({ length: 15 }, (_, i) => closed(`s${i + 1}`, i + 1));
    const d = buildDashboard(input({ sessions }));
    expect(d.history).toHaveLength(DASHBOARD.chartSessions);
    expect(d.history[0].id).toBe('s4');
    expect(d.finishedSessionCount).toBe(15);
  });
});
