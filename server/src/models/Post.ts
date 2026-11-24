import { Schema, Types, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const POST_KINDS = ['question', 'suggestion'] as const;
export const POST_MAX_LENGTH = 500;
export const REPLY_MAX_LENGTH = 1000;

/** A student's question or suggestion in a course feed. */
const postSchema = new Schema(
  {
    courseId: { type: Types.ObjectId, ref: 'Course', required: true, index: true },
    /** Set when posted while attendance was open ("during class"). */
    sessionId: { type: Types.ObjectId, ref: 'Session' },
    authorId: { type: Types.ObjectId, ref: 'User', required: true },
    /** Random id from the client, so a post retried from the offline queue is saved once. */
    clientId: { type: String, required: true },
    kind: { type: String, enum: POST_KINDS, required: true },
    text: { type: String, required: true, maxlength: POST_MAX_LENGTH },
    /** Hidden from other students only; the lecturer always sees the author. */
    anonymous: { type: Boolean, default: false },
    voterIds: { type: [{ type: Types.ObjectId, ref: 'User' }], default: [] },
    status: { type: String, enum: ['open', 'answered'], default: 'open' },
    pinned: { type: Boolean, default: false },
    /** Hidden by the lecturer: other students no longer see it. */
    hidden: { type: Boolean, default: false },
    reply: {
      type: new Schema({ text: { type: String, required: true, maxlength: REPLY_MAX_LENGTH }, at: { type: Date, required: true } }, { _id: false }),
      default: undefined,
    },
  },
  { timestamps: true },
);
postSchema.index({ authorId: 1, clientId: 1 }, { unique: true });

export type PostDoc = HydratedDocument<InferSchemaType<typeof postSchema>>;
export const Post = model('Post', postSchema);
