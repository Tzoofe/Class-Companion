import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { migrateAttendanceEmails } from '../src/lib/migrations';
import { Attendance } from '../src/models/Attendance';
import { Course } from '../src/models/Course';
import { Session } from '../src/models/Session';
import { User } from '../src/models/User';
import { api, createLecturer, loginToken, useTestDb } from './helpers';

useTestDb();

const ROSTER = [
  { email: 'dana@uni.ac.il', firstName: 'דנה', lastName: 'כהן' },
  { email: 'Late@Uni.ac.il', firstName: 'אורי', lastName: 'אלון' }, // never signs up
];
const HERE = { lat: 32.1, lng: 34.8, accuracy: 5 };

async function setup() {
  await createLecturer();
  const lect = { Authorization: `Bearer ${await loginToken('lect@uni.ac.il')}` };
  const lecturer = await User.findOne({ email: 'lect@uni.ac.il' });
  const course = await Course.create({ name: 'C', lecturerId: lecturer!._id, roster: ROSTER });
  const dana = { Authorization: `Bearer ${(await api().post('/api/auth/signup').send({ email: 'dana@uni.ac.il', password: 'secret123' })).body.token}` };
  const sessionId: string = (await api().post(`/api/courses/${course.id}/sessions`).set(lect).send({ ...HERE, accuracy: 10 })).body.session.id;
  const mark = (email: string, present: boolean, auth = lect) => api().put(`/api/sessions/${sessionId}/attendance`).set(auth).send({ email, present });
  const roster = () => api().get(`/api/sessions/${sessionId}/roster`).set(lect);
  const checkIn = () => api().post(`/api/sessions/${sessionId}/check-in`).set(dana).send({ ...HERE, timestamp: Date.now() });
  const row = async (email: string) => (await roster()).body.students.find((s: { email: string }) => s.email.toLowerCase() === email.toLowerCase());
  return { course, lect, dana, sessionId, mark, roster, checkIn, row };
}

describe('GET /api/sessions/:id/roster', () => {
  it('lists every roster student with how they attended', async () => {
    const { roster, checkIn } = await setup();
    await checkIn();
    const res = await roster();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ checkedInCount: 1, rosterCount: 2 });
    expect(res.body.students.map((s: { lastName: string }) => s.lastName)).toEqual(['אלון', 'כהן']);
    expect(res.body.students[1]).toMatchObject({ registered: true, present: true, source: 'gps', markedAbsent: false });
    expect(res.body.students[1].distanceM).toBeTypeOf('number');
    expect(res.body.students[0]).toMatchObject({ registered: false, present: false, source: null, checkedInAt: null });
  });

  it("is the owning lecturer's only", async () => {
    const { sessionId, dana } = await setup();
    await createLecturer('other@uni.ac.il');
    const other = { Authorization: `Bearer ${await loginToken('other@uni.ac.il')}` };
    expect((await api().get(`/api/sessions/${sessionId}/roster`).set(other)).status).toBe(404);
    expect((await api().get(`/api/sessions/${sessionId}/roster`).set(dana)).status).toBe(403);
  });
});

describe('PUT /api/sessions/:id/attendance', () => {
  it('marks a student without an account present (email matched case-insensitively)', async () => {
    const { mark, course, lect } = await setup();
    const res = await mark('late@uni.ac.il', true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ checkedInCount: 1, student: { present: true, source: 'manual', registered: false } });
    const stats = await api().get(`/api/courses/${course.id}/students`).set(lect);
    expect(stats.body.students.find((s: { email: string }) => s.email.toLowerCase() === 'late@uni.ac.il')).toMatchObject({ attended: 1, presentNow: true });
  });

  it('counts for the student once they sign up later', async () => {
    const { mark, course, lect } = await setup();
    await mark('late@uni.ac.il', true);
    const late = { Authorization: `Bearer ${(await api().post('/api/auth/signup').send({ email: 'late@uni.ac.il', password: 'secret123' })).body.token}` };
    const active = await api().get(`/api/courses/${course.id}/sessions/active`).set(late);
    expect(active.body.myCheckIn).not.toBeNull();
    const stats = await api().get(`/api/courses/${course.id}/students`).set(lect);
    expect(stats.body.students.find((s: { email: string }) => s.email.toLowerCase() === 'late@uni.ac.il')).toMatchObject({ registered: true, attended: 1 });
  });

  it('keeps an existing GPS check-in when marking present', async () => {
    const { mark, checkIn, row } = await setup();
    await checkIn();
    await mark('dana@uni.ac.il', true);
    expect(await row('dana@uni.ac.il')).toMatchObject({ present: true, source: 'gps' });
  });

  it('marking absent removes a GPS check-in and blocks checking in again', async () => {
    const { mark, checkIn, row, sessionId, dana } = await setup();
    expect((await checkIn()).status).toBe(201);
    const res = await mark('dana@uni.ac.il', false);
    expect(res.body).toMatchObject({ checkedInCount: 0, student: { present: false, markedAbsent: true, source: null } });
    expect(await row('dana@uni.ac.il')).toMatchObject({ present: false, markedAbsent: true });

    const again = await checkIn();
    expect(again.status).toBe(403);
    expect(again.body.error).toBe('Marked absent by lecturer');
    const range = await api().post(`/api/sessions/${sessionId}/range`).set(dana).send({ ...HERE, timestamp: Date.now() });
    expect(range.body).toMatchObject({ alreadyCheckedIn: false, markedAbsent: true });

    await mark('dana@uni.ac.il', true);
    expect(await row('dana@uni.ac.il')).toMatchObject({ present: true, source: 'manual', markedAbsent: false });
  });

  it('works after the session closed; manual marks then use the session start time', async () => {
    const { mark, row, sessionId, lect } = await setup();
    await api().post(`/api/sessions/${sessionId}/close`).set(lect);
    const session = await Session.findById(sessionId);
    expect((await mark('late@uni.ac.il', true)).status).toBe(200);
    expect(new Date((await row('late@uni.ac.il')).checkedInAt).getTime()).toBe(session!.startsAt.getTime());
  });

  it('rejects bad input, students not on the roster, and non-lecturers', async () => {
    const { mark, sessionId, lect, dana } = await setup();
    expect((await mark('stranger@uni.ac.il', true)).status).toBe(404);
    expect((await api().put(`/api/sessions/${sessionId}/attendance`).set(lect).send({ email: 'dana@uni.ac.il', present: 'yes' })).status).toBe(400);
    expect((await api().put(`/api/sessions/${sessionId}/attendance`).set(lect).send({})).status).toBe(400);
    expect((await mark('dana@uni.ac.il', true, dana)).status).toBe(403);
  });
});

describe('GET /api/courses/:id/sessions', () => {
  it('lists sessions newest first with present counts (absent marks excluded)', async () => {
    const { course, lect, mark, sessionId } = await setup();
    await mark('late@uni.ac.il', true);
    await mark('dana@uni.ac.il', false);
    await api().post(`/api/sessions/${sessionId}/close`).set(lect);
    const older = await Session.create({
      courseId: course._id,
      center: { type: 'Point', coordinates: [34.8, 32.1] },
      centerAccuracyM: 10,
      radiusM: 20,
      startsAt: new Date(Date.now() - 7 * 864e5),
      endsAt: new Date(Date.now() - 7 * 864e5 + 9e5),
      status: 'closed',
    });
    const res = await api().get(`/api/courses/${course.id}/sessions`).set(lect);
    expect(res.status).toBe(200);
    expect(res.body.rosterCount).toBe(2);
    expect(res.body.sessions.map((s: { id: string; present: number }) => [s.id, s.present])).toEqual([
      [sessionId, 1],
      [older.id, 0],
    ]);
  });
});

describe('migration from account-keyed attendance', () => {
  it('fills in emails from accounts and drops records whose account is gone', async () => {
    const dana = await User.create({ email: 'dana@uni.ac.il', passwordHash: 'x', role: 'student' });
    const raw = mongoose.connection.collection('attendances');
    const sessionId = new mongoose.Types.ObjectId();
    await raw.insertMany([
      { sessionId, studentId: dana._id, source: 'gps', checkedInAt: new Date() },
      { sessionId: new mongoose.Types.ObjectId(), studentId: new mongoose.Types.ObjectId(), source: 'gps', checkedInAt: new Date() },
    ]);
    expect(await migrateAttendanceEmails()).toBe(2);
    const left = await Attendance.find();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ email: 'dana@uni.ac.il', present: true });
    expect(await migrateAttendanceEmails()).toBe(0);
  });
});
