import { Schema, Types, model } from 'mongoose';

const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },
  { _id: false },
);

const sessionSchema = new Schema(
  {
    courseId: { type: Types.ObjectId, ref: 'Course', required: true, index: true },
    center: { type: pointSchema, required: true },
    centerAccuracyM: { type: Number, required: true, min: 0 },
    radiusM: { type: Number, required: true, min: 1 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    status: { type: String, enum: ['active', 'closed'], default: 'active' },
  },
  { timestamps: true },
);
sessionSchema.index({ center: '2dsphere' });

export const Session = model('Session', sessionSchema);
