import mongoose from 'mongoose';
import { migrateAttendanceEmails } from './lib/migrations.js';

export async function connectDb(uri: string, dbName?: string): Promise<void> {
  // Indexes are built explicitly below, after data migrations.
  await mongoose.connect(uri, { ...(dbName ? { dbName } : {}), autoIndex: false });
  const migrated = await migrateAttendanceEmails();
  if (migrated) console.log(`migrated ${migrated} attendance record(s) to roster emails`);
  // Build indexes declared in the schemas (unique, 2dsphere, ...) and drop ones no longer declared.
  await mongoose.connection.syncIndexes();
}

export const disconnectDb = () => mongoose.disconnect();
