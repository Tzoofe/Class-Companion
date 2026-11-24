import { Schema, Types, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const criterionSchema = new Schema({ id: { type: String, required: true }, title: { type: String, required: true }, description: { type: String, default: '' }, points: { type: Number, default: 0 } }, { _id: false });

/** Homework. Criteria drive both the AI review and grading. */
const assignmentSchema = new Schema(
  {
    courseId: { type: Types.ObjectId, ref: 'Course', required: true, index: true },
    title: { type: String, required: true },
    instructions: { type: String, default: '' },
    dueAt: { type: Date, required: true },
    maxPoints: { type: Number, default: 100 },
    criteria: { type: [criterionSchema], default: [] },
    /** AI reviews a student may ask for before submitting. */
    practiceLimit: { type: Number, default: 3 },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    /** Students see grades and lecturer feedback only once released. */
    gradesReleased: { type: Boolean, default: false },
    /** Anonymous class patterns for student comparisons (regenerated when more submissions are reviewed). */
    classPatterns: {
      type: new Schema(
        { approaches: [new Schema({ description: String, count: Number }, { _id: false })], commonStrengths: [String], commonGaps: [String], basedOn: Number, generatedAt: Date },
        { _id: false },
      ),
      default: undefined,
    },
    classOverview: {
      type: new Schema({ summary: String, commonIssues: [String], strengths: [String], generatedAt: Date, basedOn: Number }, { _id: false }),
      default: undefined,
    },
  },
  { timestamps: true },
);

export type AssignmentDoc = HydratedDocument<InferSchemaType<typeof assignmentSchema>>;
export const Assignment = model('Assignment', assignmentSchema);

const reviewCriterionSchema = new Schema(
  { criterionId: String, met: { type: String, enum: ['yes', 'partial', 'no', 'unknown'] }, feedback: String, suggestion: String, points: Number },
  { _id: false },
);

/** A student's submission: the final one (one per student, replaced on resubmit) or a practice draft. */
const submissionSchema = new Schema(
  {
    assignmentId: { type: Types.ObjectId, ref: 'Assignment', required: true, index: true },
    courseId: { type: Types.ObjectId, ref: 'Course', required: true },
    email: { type: String, required: true, lowercase: true },
    studentId: { type: Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['final', 'practice'], required: true },
    fileName: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    /** The original upload on disk (kept for the lecturer to download). */
    storedPath: { type: String },
    files: { type: [new Schema({ path: String, text: String, code: Boolean }, { _id: false })], default: [] },
    submittedAt: { type: Date, required: true },
    /** How late the final submission was, in ms (0 = on time). */
    lateMs: { type: Number, default: 0 },
    review: {
      status: { type: String, enum: ['queued', 'running', 'done', 'failed', 'skipped'], default: 'queued' },
      error: { type: String, default: '' },
      summary: { type: String, default: '' },
      approach: { type: String, default: '' },
      strengths: { type: [String], default: [] },
      improvements: { type: [String], default: [] },
      criteria: { type: [reviewCriterionSchema], default: [] },
      model: { type: String, default: '' },
      reviewedAt: { type: Date },
    },
    /** The student's comparison with the class (after the deadline, on request). */
    comparison: {
      type: new Schema(
        {
          status: { type: String, enum: ['queued', 'running', 'done', 'failed'] },
          error: String,
          summary: String,
          likeMost: [String],
          othersDid: [String],
          standOut: [String],
          classSize: Number,
          generatedAt: Date,
        },
        { _id: false },
      ),
      default: undefined,
    },
    grade: {
      type: new Schema(
        { points: Number, criteria: [new Schema({ criterionId: String, points: Number }, { _id: false })], comment: { type: String, default: '' }, gradedAt: Date },
        { _id: false },
      ),
      default: undefined,
    },
  },
  { timestamps: true },
);
submissionSchema.index({ assignmentId: 1, email: 1 }, { unique: true, partialFilterExpression: { kind: 'final' } });

export type SubmissionDoc = HydratedDocument<InferSchemaType<typeof submissionSchema>>;
export const Submission = model('Submission', submissionSchema);
