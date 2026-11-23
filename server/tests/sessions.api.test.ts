import { describe, expect, it } from 'vitest';
import { Attendance } from '../src/models/Attendance';
import { Course } from '../src/models/Course';
import { Session } from '../src/models/Session';
import { User } from '../src/models/User';
import { api, createLecturer, loginToken, useTestDb } from './helpers';

useTestDb();

const HERE = { lat: 32.1, lng: 34.8, accuracy: 12 };

async function setup() {
  const lect = await createLecturer();
  const course = await Course.create({
    name: 'C',
    lecturerId: lect._id,
    roster: [{ email: 'dana@uni.ac.il' }, { email: 'ron@uni.ac.il' }],
    defaultRadiusM: 25,
  });
  const token = await loginToken('lect@uni.ac.il');
  const auth = { Authorization: `Bearer ${token}` };
  const start = (body: object = HERE, id = course.id) => api().post(`/api/courses/${id}/sessions`).set(auth).send(body);
  return { lect, course, auth, start };
}

describe('POST /api/courses/:id/sessions', () => {
  it('creates an active 15-minute session centered on the lecturer, with the course radius', async () => {
    const { start } = await setup();
    const before = Date.now();
    const res = await start();
    expect(res.status).toBe(201);
    const s = res.body.session;
    expect(s).toMatchObject({ center: { lat: 32.1, lng: 34.8 }, centerAccuracyM: 12, radiusM: 25, status: 'active' });
    const minutes = (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 60_000;
    expect(minutes).toBe(15);
    expect(new Date(s.startsAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    const saved = await Session.findById(s.id);
    expect(saved?.center.coordinates).toEqual([34.8, 32.1]); // GeoJSON order: [lng, lat]
  });

  it('blocks start when accuracy is worse than 30 m', async () => {
    const { start } = await setup();
    expect((await start({ ...HERE, accuracy: 30 })).status).toBe(201);
    await Session.deleteMany({});
    const res = await start({ ...HERE, accuracy: 30.5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Location not precise enough', maxAccuracyM: 30 });
  });

  it('rejects malformed locations', async () => {
    const { start } = await setup();
    for (const bad of [{}, { lat: '32', lng: 34, accuracy: 5 }, { lat: 91, lng: 0, accuracy: 5 }, { lat: 0, lng: 181, accuracy: 5 }, { lat: 0, lng: 0, accuracy: -1 }]) {
      expect((await start(bad)).status).toBe(400);
    }
  });

  it('allows only one active session per course (409 returns the existing one)', async () => {
    const { start } = await setup();
    const first = await start();
    const second = await start();
    expect(second.status).toBe(409);
    expect(second.body.session.id).toBe(first.body.session.id);
  });

  it('allows a new session once the previous one has expired', async () => {
    const { start } = await setup();
    const first = await start();
    await Session.updateOne({ _id: first.body.session.id }, { endsAt: new Date(Date.now() - 1000) });
    expect((await start()).status).toBe(201);
    expect((await Session.findById(first.body.session.id))?.status).toBe('closed');
  });

  it("is lecturer-only and limited to the lecturer's own courses", async () => {
    const { course } = await setup();
    await createLecturer('other@uni.ac.il');
    const otherToken = await loginToken('other@uni.ac.il');
    const res = await api().post(`/api/courses/${course.id}/sessions`).set('Authorization', `Bearer ${otherToken}`).send(HERE);
    expect(res.status).toBe(404);
    const student = await api().post('/api/auth/signup').send({ email: 'dana@uni.ac.il', password: 'secret123' });
    const asStudent = await api().post(`/api/courses/${course.id}/sessions`).set('Authorization', `Bearer ${student.body.token}`).send(HERE);
    expect(asStudent.status).toBe(403);
  });
});

describe('GET /api/courses/:id/sessions/active', () => {
  it('returns null, then the active session, then null after expiry', async () => {
    const { course, auth, start } = await setup();
    const get = () => api().get(`/api/courses/${course.id}/sessions/active`).set(auth);
    expect((await get()).body.session).toBeNull();
    const created = await start();
    expect((await get()).body.session.id).toBe(created.body.session.id);
    await Session.updateOne({ _id: created.body.session.id }, { endsAt: new Date(Date.now() - 1) });
    expect((await get()).body.session).toBeNull();
  });

  it('is visible to students on the roster only', async () => {
    const { course, start } = await setup();
    await start();
    const onRoster = await api().post('/api/auth/signup').send({ email: 'dana@uni.ac.il', password: 'secret123' });
    const offRoster = await api().post('/api/auth/signup').send({ email: 'eve@uni.ac.il', password: 'secret123' });
    const get = (t: string) => api().get(`/api/courses/${course.id}/sessions/active`).set('Authorization', `Bearer ${t}`);
    expect((await get(onRoster.body.token)).body.session).not.toBeNull();
    expect((await get(offRoster.body.token)).status).toBe(404);
  });
});

describe('GET /api/sessions/:id and POST /api/sessions/:id/close', () => {
  it('reports check-in count and roster size', async () => {
    const { auth, start } = await setup();
    const { body } = await start();
    const dana = await User.create({ email: 'dana@uni.ac.il', passwordHash: 'x', role: 'student' });
    await Attendance.create({ sessionId: body.session.id, studentId: dana._id, source: 'gps', distanceM: 4, accuracyM: 8 });
    const res = await api().get(`/api/sessions/${body.session.id}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ checkedInCount: 1, rosterCount: 2, session: { status: 'active', courseName: 'C' } });
    expect(typeof res.body.serverNow).toBe('string');
  });

  it('auto-closes on read after endsAt', async () => {
    const { auth, start } = await setup();
    const { body } = await start();
    await Session.updateOne({ _id: body.session.id }, { endsAt: new Date(Date.now() - 1) });
    const res = await api().get(`/api/sessions/${body.session.id}`).set(auth);
    expect(res.body.session.status).toBe('closed');
  });

  it('closes early, setting endsAt to the close time; closing twice is harmless', async () => {
    const { auth, start } = await setup();
    const { body } = await start();
    const res = await api().post(`/api/sessions/${body.session.id}/close`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.session.status).toBe('closed');
    const endsAt = new Date(res.body.session.endsAt).getTime();
    expect(Math.abs(endsAt - Date.now())).toBeLessThan(5000);
    const again = await api().post(`/api/sessions/${body.session.id}/close`).set(auth);
    expect(again.body.session.endsAt).toBe(res.body.session.endsAt);
  });

  it("returns 404 for other lecturers' sessions and bad ids", async () => {
    const { start } = await setup();
    const { body } = await start();
    await createLecturer('other@uni.ac.il');
    const other = { Authorization: `Bearer ${await loginToken('other@uni.ac.il')}` };
    expect((await api().get(`/api/sessions/${body.session.id}`).set(other)).status).toBe(404);
    expect((await api().post(`/api/sessions/${body.session.id}/close`).set(other)).status).toBe(404);
    expect((await api().get('/api/sessions/nope').set(other)).status).toBe(404);
  });
});
