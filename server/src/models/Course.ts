import { Schema, Types, model } from 'mongoose';

const rosterEntrySchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    /** Set when the student added themselves with the course's join link. */
    joinedAt: { type: Date },
  },
  { _id: false },
);

/** A weekly class time, in the course's local time zone. */
const slotSchema = new Schema(
  {
    id: { type: String, required: true },
    weekday: { type: Number, required: true, min: 0, max: 6 }, // 0 = Sunday
    start: { type: String, required: true }, // "HH:MM"
    end: { type: String, required: true },
    title: { type: String, default: '' }, // e.g. "הרצאה", "תרגול"
    place: { type: String, default: '' },
  },
  { _id: false },
);

const courseSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    lecturerId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    // Enrollment = roster membership by email; students see a course once their email is listed.
    roster: { type: [rosterEntrySchema], default: [] },
    defaultRadiusM: { type: Number, default: 20, min: 5, max: 500 },
    /** Mandatory attendance: only then are students under the threshold flagged. */
    attendanceRequired: { type: Boolean, default: true },
    /** Join link / QR: anyone with the code can add themselves to the roster while joinOpen. */
    joinCode: { type: String },
    joinOpen: { type: Boolean, default: false },
    /** Created with "demo course" (shown as such in the UI). */
    demo: { type: Boolean, default: false },
    schedule: { type: [slotSchema], default: [] },
    /** "YYYY-MM-DD"; weekly slots repeat only between these dates (when set). */
    semesterStart: { type: String },
    semesterEnd: { type: String },
  },
  { timestamps: true },
);
courseSchema.index({ 'roster.email': 1 });
courseSchema.index({ joinCode: 1 }, { unique: true, partialFilterExpression: { joinCode: { $type: 'string' } } });

export const Course = model('Course', courseSchema);
