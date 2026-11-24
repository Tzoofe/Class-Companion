import type { Types } from 'mongoose';
import { Session, type SessionDoc } from '../models/Session.js';

/** Sessions auto-close at endsAt: called before any read, so no background job is needed. */
export async function closeExpiredSessions(filter: { courseId?: Types.ObjectId | string | { $in: Types.ObjectId[] }; _id?: Types.ObjectId | string } = {}) {
  await Session.updateMany({ ...filter, status: 'active', endsAt: { $lte: new Date() } }, { status: 'closed' });
}

export function toPublicSession(s: SessionDoc) {
  const [lng, lat] = s.center.coordinates;
  return {
    id: s.id as string,
    courseId: String(s.courseId),
    center: { lat, lng },
    centerAccuracyM: s.centerAccuracyM,
    radiusM: s.radiusM,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    status: s.status,
  };
}

/** What a student may see: no center coordinates. */
export function toStudentSession(s: SessionDoc) {
  return {
    id: s.id as string,
    courseId: String(s.courseId),
    radiusM: s.radiusM,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    status: s.status,
  };
}
