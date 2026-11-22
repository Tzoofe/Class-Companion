import { Schema, Types, model } from 'mongoose';

const attendanceSchema = new Schema(
  {
    sessionId: { type: Types.ObjectId, ref: 'Session', required: true },
    studentId: { type: Types.ObjectId, ref: 'User', required: true },
    checkedInAt: { type: Date, required: true, default: () => new Date() },
    distanceM: { type: Number }, // absent for manual entries
    accuracyM: { type: Number },
    source: { type: String, enum: ['gps', 'manual'], required: true },
  },
  { timestamps: true },
);
// One attendance record per student per session.
attendanceSchema.index({ sessionId: 1, studentId: 1 }, { unique: true });

export const Attendance = model('Attendance', attendanceSchema);
