import mongoose from 'mongoose';
import { config } from './config.js';
import { connectDb } from './db.js';
import { hashPassword } from './lib/auth.js';
import { Attendance } from './models/Attendance.js';
import { Course } from './models/Course.js';
import { Session } from './models/Session.js';
import { User } from './models/User.js';
import { COURSE_NAME, DEMO_PASSWORD, LECTURER, REGISTERED_COUNT, STUDENTS } from './seed-data.js';

await connectDb(config.mongoUri);
await Promise.all([User.deleteMany({}), Course.deleteMany({}), Session.deleteMany({}), Attendance.deleteMany({})]);

const passwordHash = await hashPassword(DEMO_PASSWORD);
const lecturer = await User.create({ ...LECTURER, passwordHash, role: 'lecturer' });
await User.insertMany(STUDENTS.slice(0, REGISTERED_COUNT).map((s) => ({ ...s, passwordHash, role: 'student' })));
await Course.create({ name: COURSE_NAME, lecturerId: lecturer._id, roster: STUDENTS, defaultRadiusM: 20 });

console.log('Seeded database. All demo accounts use the password:', DEMO_PASSWORD);
console.log(`  lecturer : ${LECTURER.email}`);
STUDENTS.forEach((s, i) =>
  console.log(`  student  : ${s.email}  ${i < REGISTERED_COUNT ? '(registered)' : '(on roster, not signed up — try /signup)'}`),
);
await mongoose.disconnect();
