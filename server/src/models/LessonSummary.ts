import { Schema, Types, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const SUMMARY_STATUSES = ['queued', 'transcribing', 'summarizing', 'draft', 'published', 'failed'] as const;

const segmentSchema = new Schema({ start: Number, end: Number, text: String }, { _id: false });

/** A lesson recording (or transcript) and the summary made from it. Drafts are visible to the lecturer only. */
const lessonSummarySchema = new Schema(
  {
    courseId: { type: Types.ObjectId, ref: 'Course', required: true, index: true },
    /** The attendance session of that lesson, when there was one. */
    sessionId: { type: Types.ObjectId, ref: 'Session' },
    date: { type: String, required: true }, // "YYYY-MM-DD", local
    title: { type: String, default: '' },
    source: { type: String, enum: ['upload', 'zoom'], required: true },
    sourceName: { type: String, default: '' },
    status: { type: String, enum: SUMMARY_STATUSES, default: 'queued' },
    /** 0–100 while processing. */
    progress: { type: Number, default: 0 },
    error: { type: String, default: '' },
    /** Recording waiting to be transcribed (deleted once transcribed). */
    mediaPath: { type: String },
    transcript: { type: [segmentSchema], default: [] },
    content: {
      overview: { type: String, default: '' },
      topics: { type: [new Schema({ at: Number, title: String, points: [String] }, { _id: false })], default: [] },
      concepts: { type: [new Schema({ term: String, definition: String }, { _id: false })], default: [] },
      reminders: { type: [String], default: [] },
      confusion: { type: [String], default: [] },
      reviewQuestions: { type: [String], default: [] },
    },
    publishedAt: { type: Date },
  },
  { timestamps: true },
);

export type LessonSummaryDoc = HydratedDocument<InferSchemaType<typeof lessonSummarySchema>>;
export const LessonSummary = model('LessonSummary', lessonSummarySchema);
