import type { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { Attendance } from '../src/models/Attendance';
import { Course } from '../src/models/Course';
import { Session } from '../src/models/Session';
import { User } from '../src/models/User';
import { api, createLecturer, loginToken, useTestDb } from './helpers';

useTestDb();

const ROSTER = [
  { email: 'dana@uni.ac.il', firstName: 'דנה', lastName: 'כהן' },
  { email: 'ron@uni.ac.il', firstName: 'רון', lastName: 'לוי' },
  { email: 'late@uni.ac.il', firstName: 'אורי', lastName: 'אלון' }, // never signs up
];

const minutes = (m: number) => new Date(Date.now() + m * 60_000);
const point = { type: 'Point' as const, coordinates: [34.8, 32.1] };

async function setup() {
  const lect = await createLecturer();
  const course = await Course.create({ name: 'C', lecturerId: lect._id, roster: ROSTER });
  const dana = await User.create({ email: 'dana@uni.ac.il', passwordHash: 'x', role: 'student' });
  const ron = await User.create({ email: 'ron@uni.ac.il', passwordHash: 'x', role: 'student' });
  const token = await loginToken('lect@uni.ac.il');
  const get = (id = course.id) => api().get(`/api/courses/${id}/students`).set('Authorization', `Bearer ${token}`);
  return { course, dana, ron, get };
}

function makeSession(courseId: Types.ObjectId, status: 'active' | 'closed', endsInMin: number) {
  return Session.create({ courseId, center: point, centerAccuracyM: 10, radiusM: 20, startsAt: minutes(endsInMin - 15), endsAt: minutes(endsInMin), status });
}

describe('GET /api/courses/:id/students', () => {
  it('returns the roster with registration status and zero stats before any session', async () => {
    const { get } = await setup();
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.course).toMatchObject({ rosterCount: 3, registeredCount: 2, sessionCount: 0, activeSessionId: null });
    expect(res.body.students.map((s: { email: string }) => s.email)).toEqual(['late@uni.ac.il', 'dana@uni.ac.il', 'ron@uni.ac.il']);
    expect(res.body.students[0]).toMatchObject({ registered: false, attended: 0, percent: null, presentNow: null });
  });

  it('computes attendance across sessions and present-now for the active one', async () => {
    const { course, dana, ron, get } = await setup();
    const past1 = await makeSession(course._id, 'closed', -60 * 24);
    const past2 = await makeSession(course._id, 'closed', -60);
    const live = await makeSession(course._id, 'active', 10);
    await Attendance.create([
      { sessionId: past1._id, studentId: dana._id, source: 'gps', distanceM: 5, accuracyM: 8 },
      { sessionId: past2._id, studentId: dana._id, source: 'manual' },
      { sessionId: live._id, studentId: dana._id, source: 'gps', distanceM: 3, accuracyM: 6 },
      { sessionId: past1._id, studentId: ron._id, source: 'gps', distanceM: 9, accuracyM: 12 },
    ]);
    const res = await get();
    expect(res.body.course).toMatchObject({ sessionCount: 3, activeSessionId: live.id });
    const by = Object.fromEntries(res.body.students.map((s: { email: string }) => [s.email, s]));
    expect(by['dana@uni.ac.il']).toMatchObject({ attended: 3, totalSessions: 3, percent: 100, presentNow: true });
    expect(by['ron@uni.ac.il']).toMatchObject({ attended: 1, percent: 33, presentNow: false });
    expect(by['late@uni.ac.il']).toMatchObject({ attended: 0, percent: 0, presentNow: false, lastSeenAt: null });
    expect(typeof by['dana@uni.ac.il'].lastSeenAt).toBe('string');
  });

  it("does not count attendance from another course's sessions", async () => {
    const { course, dana, get } = await setup();
    const other = await Course.create({ name: 'Other', lecturerId: course.lecturerId });
    const s = await makeSession(other._id, 'closed', -60);
    await Attendance.create({ sessionId: s._id, studentId: dana._id, source: 'gps' });
    const res = await get();
    expect(res.body.students.every((r: { attended: number }) => r.attended === 0)).toBe(true);
  });

  it("returns 404 for another lecturer's course and for bad ids", async () => {
    const { get } = await setup();
    const other = await createLecturer('other@uni.ac.il');
    const theirs = await Course.create({ name: 'Theirs', lecturerId: other._id });
    expect((await get(theirs.id)).status).toBe(404);
    expect((await get('not-an-id')).status).toBe(404);
    expect((await get('64b000000000000000000000')).status).toBe(404);
  });

  it('is lecturer-only', async () => {
    const { course } = await setup();
    const signup = await api().post('/api/auth/signup').send({ email: 'dana2@uni.ac.il', password: 'secret123' });
    const res = await api().get(`/api/courses/${course.id}/students`).set('Authorization', `Bearer ${signup.body.token}`);
    expect(res.status).toBe(403);
  });
});
