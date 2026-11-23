import { describe, expect, it } from 'vitest';
import { Attendance } from '../src/models/Attendance';
import { Course } from '../src/models/Course';
import { Session } from '../src/models/Session';
import { api, createLecturer, loginToken, useTestDb } from './helpers';

useTestDb();

// Session center 32.1, 34.8 (±10 m), radius 20 m.
const CENTER = { lat: 32.1, lng: 34.8, accuracy: 10 };
const NEAR = { lat: 32.1001, lng: 34.8, accuracy: 5 }; // ≈ 11 m → in range
const FAR = { lat: 32.102, lng: 34.8, accuracy: 5 }; // ≈ 222 m → out of range

const reading = (loc: { lat: number; lng: number; accuracy: number }, ageMs = 0) => ({ ...loc, timestamp: Date.now() - ageMs });

async function setup() {
  await createLecturer();
  const lectAuth = { Authorization: `Bearer ${await loginToken('lect@uni.ac.il')}` };
  const lect = await createLecturerCourse(lectAuth);
  const signup = async (email: string) => ({
    Authorization: `Bearer ${(await api().post('/api/auth/signup').send({ email, password: 'secret123' })).body.token}`,
  });
  const dana = await signup('dana@uni.ac.il');
  const sessionId: string = (await api().post(`/api/courses/${lect.courseId}/sessions`).set(lectAuth).send(CENTER)).body.session.id;
  const range = (auth: Record<string, string>, body: object) => api().post(`/api/sessions/${sessionId}/range`).set(auth).send(body);
  const checkIn = (auth: Record<string, string>, body: object) => api().post(`/api/sessions/${sessionId}/check-in`).set(auth).send(body);
  return { ...lect, lectAuth, dana, signup, sessionId, range, checkIn };
}

async function createLecturerCourse(lectAuth: Record<string, string>) {
  const me = await api().get('/api/auth/me').set(lectAuth);
  const course = await Course.create({
    name: 'C',
    lecturerId: me.body.user.id,
    roster: [{ email: 'dana@uni.ac.il', firstName: 'דנה', lastName: 'כהן' }, { email: 'ron@uni.ac.il' }],
    defaultRadiusM: 20,
  });
  return { courseId: course.id as string };
}

describe('POST /api/sessions/:id/range', () => {
  it('reports in range with distance, without recording anything', async () => {
    const { dana, range } = await setup();
    const res = await range(dana, reading(NEAR));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ inRange: true, alreadyCheckedIn: false });
    expect(res.body.distanceM).toBeCloseTo(11.1, 0);
    expect(await Attendance.countDocuments()).toBe(0);
  });

  it('reports out of range with distance', async () => {
    const { dana, range } = await setup();
    const res = await range(dana, reading(FAR));
    expect(res.body.inRange).toBe(false);
    expect(res.body.distanceM).toBeGreaterThan(200);
  });

  it('rejects readings less precise than 100 m', async () => {
    const { dana, range } = await setup();
    const res = await range(dana, reading({ ...NEAR, accuracy: 150 }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Location too imprecise', maxAccuracyM: 100 });
  });

  it('rejects malformed readings', async () => {
    const { dana, range } = await setup();
    expect((await range(dana, { ...NEAR })).status).toBe(400); // no timestamp
    expect((await range(dana, { lat: 'x' })).status).toBe(400);
  });
});

describe('POST /api/sessions/:id/check-in', () => {
  it('records GPS attendance once, with distance and accuracy', async () => {
    const { dana, checkIn, sessionId, lectAuth } = await setup();
    const res = await checkIn(dana, reading(NEAR));
    expect(res.status).toBe(201);
    const saved = await Attendance.findOne({ sessionId });
    expect(saved).toMatchObject({ source: 'gps', accuracyM: 5 });
    expect(saved!.distanceM).toBeCloseTo(11.1, 0);
    const status = await api().get(`/api/sessions/${sessionId}`).set(lectAuth);
    expect(status.body.checkedInCount).toBe(1);
  });

  it('a second check-in returns 409 and keeps a single record', async () => {
    const { dana, checkIn, range } = await setup();
    const first = await checkIn(dana, reading(NEAR));
    const second = await checkIn(dana, reading(NEAR));
    expect(second.status).toBe(409);
    expect(second.body.checkedInAt).toBe(first.body.checkedInAt);
    expect(await Attendance.countDocuments()).toBe(1);
    expect((await range(dana, reading(NEAR))).body.alreadyCheckedIn).toBe(true);
  });

  it('re-validates range on the server: out of range is refused', async () => {
    const { dana, checkIn } = await setup();
    const res = await checkIn(dana, reading(FAR));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Not in range');
    expect(await Attendance.countDocuments()).toBe(0);
  });

  it('requires a fresh reading (≤ 30 s old)', async () => {
    const { dana, checkIn } = await setup();
    const stale = await checkIn(dana, reading(NEAR, 31_000));
    expect(stale.status).toBe(400);
    expect(stale.body.error).toBe('Location reading too old');
    expect((await checkIn(dana, reading(NEAR, 20_000))).status).toBe(201);
  });

  it('refuses after the session closed or expired', async () => {
    const { dana, checkIn, sessionId, lectAuth } = await setup();
    await api().post(`/api/sessions/${sessionId}/close`).set(lectAuth);
    const res = await checkIn(dana, reading(NEAR));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Session is not active');
  });

  it('refuses expired sessions even if not yet closed', async () => {
    const { dana, checkIn, sessionId } = await setup();
    await Session.updateOne({ _id: sessionId }, { endsAt: new Date(Date.now() - 1) });
    expect((await checkIn(dana, reading(NEAR))).status).toBe(409);
  });

  it('hides the session from students not on the roster (404) and refuses lecturers (403)', async () => {
    const { signup, checkIn, lectAuth } = await setup();
    const eve = await signup('eve@uni.ac.il');
    expect((await checkIn(eve, reading(NEAR))).status).toBe(404);
    expect((await checkIn(lectAuth, reading(NEAR))).status).toBe(403);
    expect((await api().post('/api/sessions/nope/check-in').set(eve).send(reading(NEAR))).status).toBe(404);
  });
});

describe('GET /api/courses/:id/sessions/active (student view)', () => {
  it('hides the center and reports the student own check-in', async () => {
    const { dana, checkIn, courseId } = await setup();
    const get = () => api().get(`/api/courses/${courseId}/sessions/active`).set(dana);
    const before = await get();
    expect(before.body.session.center).toBeUndefined();
    expect(before.body.session.centerAccuracyM).toBeUndefined();
    expect(before.body).toMatchObject({ courseName: 'C', myCheckIn: null });
    await checkIn(dana, reading(NEAR));
    expect((await get()).body.myCheckIn.checkedInAt).toEqual(expect.any(String));
  });
});
