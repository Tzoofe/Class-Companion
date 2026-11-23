import { Schema, Types, model } from 'mongoose';

/**
 * One record per roster email per session. `present: false` means the lecturer marked the
 * student absent (it also blocks a later GPS check-in to that session).
 */
const attendanceSchema = new Schema(
  {
    sessionId: { type: Types.ObjectId, ref: 'Session', required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    /** Account that checked in (GPS), if any. */
    studentId: { type: Types.ObjectId, ref: 'User' },
    present: { type: Boolean, required: true, default: true },
    checkedInAt: { type: Date, required: true, default: () => new Date() },
    distanceM: { type: Number }, // GPS only
    accuracyM: { type: Number },
    source: { type: String, enum: ['gps', 'manual'], required: true },
  },
  { timestamps: true },
);
attendanceSchema.index({ sessionId: 1, email: 1 }, { unique: true });

/** Filter for records that count as attended. */
export const PRESENT = { present: { $ne: false } } as const;

export const Attendance = model('Attendance', attendanceSchema);
