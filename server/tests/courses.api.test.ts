import { describe, expect, it } from 'vitest';
import { Attendance } from '../src/models/Attendance';
import { Course } from '../src/models/Course';
import { api, createLecturer, csv, loginToken, upload, useTestDb } from './helpers';

useTestDb();

const ROSTER = csv([
  ['שם פרטי', 'שם משפחה', 'דוא״ל'],
  ['דנה', 'כהן', 'dana@uni.ac.il'],
  ['רון', 'לוי', 'ron@uni.ac.il'],
  ['בעיה', 'בשורה', 'not-an-email'],
]);

async function lecturerToken() {
  await createLecturer();
  return loginToken('lect@uni.ac.il');
}

async function studentToken(email: string) {
  const res = await api().post('/api/auth/signup').send({ email, password: 'secret123' });
  return res.body.token as string;
}

describe('POST /api/courses/preview', () => {
  it('parses the file without saving a course', async () => {
    const token = await lecturerToken();
    const res = await api()
      .post('/api/courses/preview')
      .set('Authorization', `Bearer ${token}`)
      .send(upload(ROSTER, 'roster.csv'));
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.skipped).toEqual([{ row: 4, value: 'not-an-email', reason: 'invalid email' }]);
    expect(await Course.countDocuments()).toBe(0);
  });

  it('rejects a missing file and unsupported types', async () => {
    const token = await lecturerToken();
    const auth = { Authorization: `Bearer ${token}` };
    expect((await api().post('/api/courses/preview').set(auth).send({})).status).toBe(400);
    const pdf = await api().post('/api/courses/preview').set(auth).send(upload(Buffer.from('x'), 'r.pdf'));
    expect(pdf.status).toBe(400);
    const big = await api().post('/api/courses/preview').set(auth).send(upload(Buffer.alloc(2 * 1024 * 1024 + 1), 'r.csv'));
    expect(big.status).toBe(400);
    expect(big.body.error).toBe('File too large (max 2 MB)');
  });
});

describe('POST /api/courses', () => {
  it('creates a course with the roster from the file', async () => {
    const token = await lecturerToken();
    const res = await api()
      .post('/api/courses')
      .set('Authorization', `Bearer ${token}`)
      .send(upload(ROSTER, 'roster.csv', { name: 'מבוא להנדסת תוכנה', defaultRadiusM: 25 }));
    expect(res.status).toBe(201);
    expect(res.body.course).toMatchObject({ name: 'מבוא להנדסת תוכנה', rosterCount: 2, defaultRadiusM: 25 });
    const saved = await Course.findById(res.body.course.id);
    expect(saved?.roster.map((r) => r.email)).toEqual(['dana@uni.ac.il', 'ron@uni.ac.il']);
  });

  it('validates name, radius and that the file has emails', async () => {
    const token = await lecturerToken();
    const post = () => api().post('/api/courses').set('Authorization', `Bearer ${token}`);
    expect((await post().send(upload(ROSTER, 'r.csv', { name: '' }))).status).toBe(400);
    expect((await post().send(upload(ROSTER, 'r.csv', { name: 'C', defaultRadiusM: 0 }))).status).toBe(400);
    const empty = csv([['a', 'b'], ['c', 'd']]);
    expect((await post().send(upload(empty, 'r.csv', { name: 'C' }))).status).toBe(400);
  });

  it('is lecturer-only', async () => {
    const token = await studentToken('dana@uni.ac.il');
    const res = await api()
      .post('/api/courses')
      .set('Authorization', `Bearer ${token}`)
      .send(upload(ROSTER, 'r.csv', { name: 'C' }));
    expect(res.status).toBe(403);
  });

  it('requires login', async () => {
    expect((await api().post('/api/courses').send({ name: 'C' })).status).toBe(401);
  });
});

describe('GET /api/courses', () => {
  it('lecturer sees only their own courses', async () => {
    const lect = await createLecturer();
    const other = await createLecturer('other@uni.ac.il');
    await Course.create({ name: 'Mine', lecturerId: lect._id, roster: [{ email: 'a@x.com' }] });
    await Course.create({ name: 'Theirs', lecturerId: other._id });
    const token = await loginToken('lect@uni.ac.il');
    const res = await api().get('/api/courses').set('Authorization', `Bearer ${token}`);
    expect(res.body.courses).toEqual([expect.objectContaining({ name: 'Mine', rosterCount: 1 })]);
  });

  it('student sees exactly the courses whose roster lists their email', async () => {
    const lect = await createLecturer();
    await Course.create({ name: 'Listed', lecturerId: lect._id, roster: [{ email: 'dana@uni.ac.il' }] });
    await Course.create({ name: 'Not listed', lecturerId: lect._id, roster: [{ email: 'ron@uni.ac.il' }] });
    const token = await studentToken('Dana@uni.ac.il');
    const res = await api().get('/api/courses').set('Authorization', `Bearer ${token}`);
    expect(res.body.courses).toEqual([{ id: expect.any(String), name: 'Listed', lecturerName: 'יעל מרצה' }]);
  });

  it('a course appears for a student once the lecturer adds their email later', async () => {
    const lect = await createLecturer();
    const course = await Course.create({ name: 'Later', lecturerId: lect._id });
    const token = await studentToken('late@uni.ac.il');
    const get = () => api().get('/api/courses').set('Authorization', `Bearer ${token}`);
    expect((await get()).body.courses).toEqual([]);
    course.roster.push({ email: 'late@uni.ac.il' });
    await course.save();
    expect((await get()).body.courses).toHaveLength(1);
  });
});

describe('Attendance model', () => {
  it('allows only one attendance per student per session', async () => {
    const ids = { sessionId: '64b000000000000000000001', studentId: '64b000000000000000000002' };
    await Attendance.create({ ...ids, source: 'gps' });
    await expect(Attendance.create({ ...ids, source: 'manual' })).rejects.toThrow(/duplicate key/);
  });
});
