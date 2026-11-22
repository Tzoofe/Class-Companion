import { Schema, Types, model } from 'mongoose';

const rosterEntrySchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
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
  },
  { timestamps: true },
);
courseSchema.index({ 'roster.email': 1 });

export const Course = model('Course', courseSchema);
