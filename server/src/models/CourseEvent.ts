import { Schema, Types, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const EVENT_KINDS = ['extra', 'cancelled', 'office', 'meeting', 'exam', 'other'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * A one-off item on a course's calendar: an extra lesson, office hours, a meeting, an exam…
 * `cancelled` cancels one occurrence of a weekly slot (slotId on `date`).
 */
const courseEventSchema = new Schema(
  {
    courseId: { type: Types.ObjectId, ref: 'Course', required: true, index: true },
    kind: { type: String, enum: EVENT_KINDS, required: true },
    date: { type: String, required: true }, // "YYYY-MM-DD" (local)
    start: { type: String }, // "HH:MM"
    end: { type: String },
    title: { type: String, default: '' },
    place: { type: String, default: '' },
    link: { type: String, default: '' },
    notes: { type: String, default: '' },
    slotId: { type: String },
  },
  { timestamps: true },
);
courseEventSchema.index({ courseId: 1, date: 1 });

export type CourseEventDoc = HydratedDocument<InferSchemaType<typeof courseEventSchema>>;
export const CourseEvent = model('CourseEvent', courseEventSchema);
