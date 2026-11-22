import mongoose from 'mongoose';

export async function connectDb(uri: string, dbName?: string): Promise<void> {
  await mongoose.connect(uri, dbName ? { dbName } : {});
  // Build indexes declared in the schemas (unique, 2dsphere, ...).
  await mongoose.connection.syncIndexes();
}

export const disconnectDb = () => mongoose.disconnect();
