import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';
import { createApp } from '../src/app';
import { connectDb } from '../src/db';
import { hashPassword } from '../src/lib/auth';
import { User } from '../src/models/User';

/** Connects to a fresh database (one per test file) and wipes it before each test. */
export function useTestDb() {
  beforeAll(async () => {
    const dbName = `test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    await connectDb(inject('mongoUri'), dbName);
  });
  beforeEach(async () => {
    await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}

export const app = createApp();
export const api = () => request(app);

export async function createLecturer(email = 'lect@uni.ac.il', password = 'secret123') {
  return User.create({ email, passwordHash: await hashPassword(password), role: 'lecturer', firstName: 'יעל', lastName: 'מרצה' });
}

export async function loginToken(email: string, password = 'secret123'): Promise<string> {
  const res = await api().post('/api/auth/login').send({ email, password });
  return res.body.token;
}

export const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n'), 'utf8');

/** Body for roster upload endpoints. */
export const upload = (file: Buffer, fileName: string, extra: Record<string, unknown> = {}) => ({
  ...extra,
  fileName,
  fileBase64: file.toString('base64'),
});
