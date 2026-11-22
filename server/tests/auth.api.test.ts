import { describe, expect, it } from 'vitest';
import { Course } from '../src/models/Course';
import { User } from '../src/models/User';
import { api, createLecturer, loginToken, useTestDb } from './helpers';

useTestDb();

describe('POST /api/auth/signup', () => {
  it('creates a student and fills the name from the roster', async () => {
    const lect = await createLecturer();
    await Course.create({ name: 'C', lecturerId: lect._id, roster: [{ email: 'dana@uni.ac.il', firstName: 'דנה', lastName: 'כהן' }] });

    const res = await api().post('/api/auth/signup').send({ email: ' Dana@Uni.ac.il ', password: 'secret123' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.user).toMatchObject({ email: 'dana@uni.ac.il', role: 'student', firstName: 'דנה', lastName: 'כהן' });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('allows emails that are on no roster (they just see no courses)', async () => {
    const res = await api().post('/api/auth/signup').send({ email: 'x@y.com', password: 'secret123' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ firstName: '', lastName: '' });
  });

  it('always creates students, never lecturers', async () => {
    await api().post('/api/auth/signup').send({ email: 'x@y.com', password: 'secret123', role: 'lecturer' });
    expect((await User.findOne({ email: 'x@y.com' }))?.role).toBe('student');
  });

  it('rejects duplicate emails (case-insensitive)', async () => {
    await api().post('/api/auth/signup').send({ email: 'x@y.com', password: 'secret123' });
    const res = await api().post('/api/auth/signup').send({ email: 'X@Y.com', password: 'secret123' });
    expect(res.status).toBe(409);
  });

  it('rejects invalid email and short password', async () => {
    expect((await api().post('/api/auth/signup').send({ email: 'nope', password: 'secret123' })).status).toBe(400);
    expect((await api().post('/api/auth/signup').send({ email: 'x@y.com', password: '123' })).status).toBe(400);
    expect((await api().post('/api/auth/signup').send({})).status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('returns a token for correct credentials', async () => {
    await createLecturer();
    const res = await api().post('/api/auth/login').send({ email: 'LECT@uni.ac.il', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('lecturer');
  });

  it('gives the same 401 for wrong password and unknown email', async () => {
    await createLecturer();
    const wrong = await api().post('/api/auth/login').send({ email: 'lect@uni.ac.il', password: 'bad-pass' });
    const unknown = await api().post('/api/auth/login').send({ email: 'who@uni.ac.il', password: 'secret123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the logged-in user', async () => {
    await createLecturer();
    const token = await loginToken('lect@uni.ac.il');
    const res = await api().get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('lect@uni.ac.il');
  });

  it('rejects missing or forged tokens', async () => {
    expect((await api().get('/api/auth/me')).status).toBe(401);
    expect((await api().get('/api/auth/me').set('Authorization', 'Bearer abc.def.ghi')).status).toBe(401);
  });
});
