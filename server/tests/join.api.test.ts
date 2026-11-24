import { describe, expect, it } from 'vitest';
import { Course } from '../src/models/Course';
import { User } from '../src/models/User';
import { newJoinCode } from '../src/routes/join';
import { api, createLecturer, loginToken, useTestDb } from './helpers';

useTestDb();

async function setup() {
  await createLecturer();
  const lect = { Authorization: `Bearer ${await loginToken('lect@uni.ac.il')}` };
  const demo = (await api().post('/api/courses/demo').set(lect)).body.course;
  const join = (body: object, code = demo.joinCode) => api().post(`/api/join/${code}`).send(body);
  return { lect, demo, join };
}

describe('join codes', () => {
  it('uses unambiguous characters', () => {
    for (let i = 0; i < 50; i++) expect(newJoinCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
  });
});

describe('demo course', () => {
  it('creates an empty course with the join link open and a lesson happening now', async () => {
    const { lect, demo } = await setup();
    expect(demo.joinCode).toMatch(/^[A-Z2-9]{6}$/);
    const c = await Course.findById(demo.id);
    expect(c).toMatchObject({ demo: true, joinOpen: true, attendanceRequired: false });
    expect(c!.roster).toHaveLength(0);
    const agenda = await api().get('/api/me/agenda?days=1').set(lect);
    expect(agenda.body.items.some((i: { courseId: string }) => i.courseId === demo.id)).toBe(true);
  });
});

describe('POST /api/join/:code', () => {
  it('creates a signed-in student with any email domain and adds them to the roster', async () => {
    const { demo, join } = await setup();
    expect((await api().get(`/api/join/${demo.joinCode.toLowerCase()}`)).body.course).toMatchObject({ id: demo.id, demo: true });
    const res = await join({ firstName: ' דנה ', lastName: 'כהן', email: 'Dana@Gmail.com' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ courseId: demo.id, user: { email: 'dana@gmail.com', firstName: 'דנה', role: 'student' } });
    const courses = await api().get('/api/courses').set({ Authorization: `Bearer ${res.body.token}` });
    expect(courses.body.courses.map((c: { id: string }) => c.id)).toEqual([demo.id]);
    expect((await Course.findById(demo.id))!.roster[0]).toMatchObject({ email: 'dana@gmail.com', firstName: 'דנה', lastName: 'כהן', joinedAt: expect.any(Date) });
  });

  it('lets a new student set a password to log in elsewhere', async () => {
    const { join } = await setup();
    await join({ firstName: 'רון', email: 'ron@gmail.com', password: 'secret123' });
    expect((await api().post('/api/auth/login').send({ email: 'ron@gmail.com', password: 'secret123' })).status).toBe(200);
    expect((await join({ firstName: 'x', email: 'short@gmail.com', password: '123' })).status).toBe(400);
  });

  it("requires the existing account's password, so nobody can take over an account by email", async () => {
    const { join } = await setup();
    await api().post('/api/auth/signup').send({ email: 'noa@uni.ac.il', password: 'secret123' });
    const noPass = await join({ firstName: 'נועה', email: 'noa@uni.ac.il' });
    expect(noPass.status).toBe(409);
    expect(noPass.body).toMatchObject({ needsPassword: true });
    expect(noPass.body.token).toBeUndefined();
    expect((await join({ firstName: 'נועה', email: 'noa@uni.ac.il', password: 'wrong' })).status).toBe(401);
    expect((await join({ firstName: 'נועה', email: 'noa@uni.ac.il', password: 'secret123' })).status).toBe(201);
    expect((await join({ firstName: 'x', email: 'lect@uni.ac.il', password: 'secret123' })).status).toBe(403);
  });

  it('is idempotent, validates input, and stops working when closed or regenerated', async () => {
    const { demo, join, lect } = await setup();
    await join({ firstName: 'א', email: 'a@gmail.com', password: 'secret123' });
    await join({ firstName: 'א', email: 'a@gmail.com', password: 'secret123' });
    expect((await Course.findById(demo.id))!.roster).toHaveLength(1);
    expect((await join({ firstName: '', email: 'b@gmail.com' })).body.error).toBe('First name is required');
    expect((await join({ firstName: 'ב', email: 'nope' })).body.error).toBe('Invalid email');

    const regen = await api().post(`/api/courses/${demo.id}/join`).set(lect).send({ regenerate: true });
    expect(regen.body.joinCode).not.toBe(demo.joinCode);
    expect((await join({ firstName: 'ב', email: 'b@gmail.com' })).status).toBe(404); // old code
    await api().post(`/api/courses/${demo.id}/join`).set(lect).send({ open: false });
    expect((await join({ firstName: 'ב', email: 'b@gmail.com' }, regen.body.joinCode)).status).toBe(404);
    expect(await User.countDocuments({ email: 'b@gmail.com' })).toBe(0);
  });

  it('shows the lecturer who joined, newest first; other lecturers get 404', async () => {
    const { demo, join, lect } = await setup();
    await join({ firstName: 'ראשון', email: 'first@gmail.com' });
    await join({ firstName: 'שני', email: 'second@gmail.com' });
    const status = await api().get(`/api/courses/${demo.id}/join`).set(lect);
    expect(status.body).toMatchObject({ joinOpen: true, rosterCount: 2 });
    expect(status.body.joined.map((j: { firstName: string }) => j.firstName)).toEqual(['שני', 'ראשון']);
    await createLecturer('other@uni.ac.il');
    const other = { Authorization: `Bearer ${await loginToken('other@uni.ac.il')}` };
    expect((await api().get(`/api/courses/${demo.id}/join`).set(other)).status).toBe(404);
  });

  it('can open a join link on a regular course too', async () => {
    const { lect } = await setup();
    const lecturer = await User.findOne({ email: 'lect@uni.ac.il' });
    const course = await Course.create({ name: 'רגיל', lecturerId: lecturer!._id, roster: [] });
    const r = await api().post(`/api/courses/${course.id}/join`).set(lect).send({ open: true });
    expect(r.body).toMatchObject({ joinOpen: true, joinCode: expect.stringMatching(/^[A-Z2-9]{6}$/) });
    expect((await api().get(`/api/courses/${course.id}/settings`).set(lect)).body.course).toMatchObject({ joinOpen: true, joinCode: r.body.joinCode });
  });
});

describe('demo screen actions', () => {
  it('accepts the quick poll and demo assignment the demo screen sends', async () => {
    const { lect, demo, join } = await setup();
    const student = await join({ firstName: 'דנה', email: 'dana@gmail.com' });
    const poll = await api()
      .post(`/api/courses/${demo.id}/polls`)
      .set(lect)
      .send({ question: 'הבנתם את מה שראינו עד עכשיו?', type: 'choice', options: ['כן, הכל ברור', 'בערך', 'לא, צריך הסבר נוסף'], open: true });
    expect(poll.status).toBe(201);
    const a = await api()
      .post(`/api/courses/${demo.id}/assignments`)
      .set(lect)
      .send({
        title: 'מטלת הדגמה: רקורסיה',
        instructions: 'כתבו פונקציה רקורסיבית',
        dueAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        criteria: [
          { id: 'base', title: 'מקרה בסיס נכון', points: 40 },
          { id: 'rec', title: 'צעד רקורסיבי נכון', points: 40 },
          { id: 'cx', title: 'ניתוח סיבוכיות', points: 20 },
        ],
        practiceLimit: 3,
        publish: true,
      });
    expect(a.status).toBe(201);
    expect(a.body.assignment).toMatchObject({ maxPoints: 100, status: 'published' });
    // The student who joined by QR sees both.
    const s = { Authorization: `Bearer ${student.body.token}` };
    expect((await api().get(`/api/courses/${demo.id}/assignments`).set(s)).body.assignments).toHaveLength(1);
    expect((await api().get(`/api/courses/${demo.id}/polls`).set(s)).body.polls).toHaveLength(1);
  });
});
