import mongoose from 'mongoose';

/**
 * Attendance used to be keyed by account (studentId); it is now keyed by roster email.
 * Fills in `email` for old records (dropping ones whose account no longer exists).
 * Runs before indexes are built, since the new unique index needs every email set.
 */
export async function migrateAttendanceEmails(): Promise<number> {
  const attendance = mongoose.connection.collection('attendances');
  const old = await attendance.find({ email: { $exists: false } }, { projection: { studentId: 1 } }).toArray();
  if (old.length === 0) return 0;
  const users = await mongoose.connection
    .collection('users')
    .find({ _id: { $in: old.map((a) => a.studentId) } }, { projection: { email: 1 } })
    .toArray();
  const emailById = new Map(users.map((u) => [String(u._id), String(u.email).toLowerCase()]));
  await attendance.bulkWrite(
    old.map((a) => {
      const email = emailById.get(String(a.studentId));
      return email
        ? { updateOne: { filter: { _id: a._id }, update: { $set: { email, present: true } } } }
        : { deleteOne: { filter: { _id: a._id } } };
    }),
  );
  return old.length;
}
