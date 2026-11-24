import { Schema, Types, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const POLL_TYPES = ['choice', 'yesno', 'scale', 'text'] as const;
export type PollType = (typeof POLL_TYPES)[number];

const optionSchema = new Schema({ id: { type: String, required: true }, text: { type: String, required: true } }, { _id: false });

/** A lecturer's poll. Draft → open → closed (can be reopened). */
const pollSchema = new Schema(
  {
    courseId: { type: Types.ObjectId, ref: 'Course', required: true, index: true },
    question: { type: String, required: true },
    type: { type: String, enum: POLL_TYPES, required: true },
    /** Choice polls: allow selecting several options. */
    multiple: { type: Boolean, default: false },
    /** Choice and yes/no polls. */
    options: { type: [optionSchema], default: [] },
    /** Optional correct option ids, revealed with the results. */
    correctOptionIds: { type: [String], default: [] },
    /** 'present': only students present in the session that was active when the poll opened. */
    audience: { type: String, enum: ['roster', 'present'], default: 'roster' },
    /** Text polls: show the answers on the projector. */
    showTextOnScreen: { type: Boolean, default: true },
    status: { type: String, enum: ['draft', 'open', 'closed'], default: 'draft' },
    /** Students see results only once revealed. */
    resultsRevealed: { type: Boolean, default: false },
    sessionId: { type: Types.ObjectId, ref: 'Session' },
    openedAt: { type: Date },
    closedAt: { type: Date },
  },
  { timestamps: true },
);

export type PollDoc = HydratedDocument<InferSchemaType<typeof pollSchema>>;
export const Poll = model('Poll', pollSchema);

/** One student's answer to a poll (replaced when they change it). */
const pollResponseSchema = new Schema(
  {
    pollId: { type: Types.ObjectId, ref: 'Poll', required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    studentId: { type: Types.ObjectId, ref: 'User', required: true },
    optionIds: { type: [String], default: undefined },
    value: { type: Number },
    text: { type: String },
  },
  { timestamps: true },
);
pollResponseSchema.index({ pollId: 1, email: 1 }, { unique: true });

export type PollResponseDoc = HydratedDocument<InferSchemaType<typeof pollResponseSchema>>;
export const PollResponse = model('PollResponse', pollResponseSchema);
