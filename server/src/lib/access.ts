import mongoose from 'mongoose';
import { Course } from '../models/Course.js';
import { User } from '../models/User.js';

/** The lecturer's own course, or null (other lecturers' courses look like 404). */
export function findOwnCourse(id: string, lecturerId: string) {
  return mongoose.isValidObjectId(id) ? Course.findOne({ _id: id, lecturerId }) : Promise.resolve(null);
}

/** Lecturer: own course. Student: course whose roster lists their email. */
export async function findAccessibleCourse(id: string, auth: { sub: string; role: string }) {
  if (!mongoose.isValidObjectId(id)) return null;
  if (auth.role === 'lecturer') return Course.findOne({ _id: id, lecturerId: auth.sub });
  const me = await User.findById(auth.sub, { email: 1 });
  return me ? Course.findOne({ _id: id, 'roster.email': me.email }) : null;
}
