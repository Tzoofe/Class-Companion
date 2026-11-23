import { Router } from 'express';
import mongoose from 'mongoose';
import { ATTENDANCE_RULES, evaluateRange, isFresh, isPreciseEnoughToCheckIn } from '../../../shared/attendance.js';
import { closeExpiredSessions, toPublicSession } from '../lib/sessions.js';
import { readReading, type ReadingBody } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { Attendance } from '../models/Attendance.js';
import { Course } from '../models/Course.js';
import { Session, type SessionDoc } from '../models/Session.js';
import { User } from '../models/User.js';

export const sessionsRouter = Router();
sessionsRouter.use(requireAuth);

/** Loads a session together with its course, only if the course belongs to this lecturer. */
async function findOwnSession(id: string, lecturerId: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  await closeExpiredSessions({ _id: id });
  const session = await Session.findById(id);
  if (!session) return null;
  const course = await Course.findOne({ _id: session.courseId, lecturerId }, { name: 1, roster: 1 });
  return course ? { session, course } : null;
}

async function summary(session: SessionDoc, course: { name: string; roster: unknown[] }) {
  return {
    session: { ...toPublicSession(session), courseName: course.name },
    checkedInCount: await Attendance.countDocuments({ sessionId: session._id }),
    rosterCount: course.roster.length,
    serverNow: new Date(),
  };
}

/** Live session status for the lecturer (polled every few seconds). */
sessionsRouter.get('/:id', requireRole('lecturer'), async (req, res) => {
  const found = await findOwnSession(String(req.params.id), req.auth!.sub);
  if (!found) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(await summary(found.session, found.course));
});

/** Close a session early; endsAt becomes the actual close time. Closing twice is a no-op. */
sessionsRouter.post('/:id/close', requireRole('lecturer'), async (req, res) => {
  const found = await findOwnSession(String(req.params.id), req.auth!.sub);
  if (!found) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const { session, course } = found;
  if (session.status === 'active') {
    session.status = 'closed';
    session.endsAt = new Date();
    await session.save();
  }
  res.json(await summary(session, course));
});

type Reply = { status: number; body: Record<string, unknown> };

/**
 * Shared checks for a student's reading against a session:
 * session exists and student is on its roster (else 404), session active (409),
 * reading well-formed (400) and precise enough (400). Returns the range verdict.
 */
async function checkStudentReading(sessionId: string, studentId: string, body: unknown): Promise<Reply | { session: SessionDoc; reading: ReadingBody; distanceM: number; inRange: boolean }> {
  if (!mongoose.isValidObjectId(sessionId)) return { status: 404, body: { error: 'Session not found' } };
  await closeExpiredSessions({ _id: sessionId });
  const [session, me] = await Promise.all([Session.findById(sessionId), User.findById(studentId, { email: 1 })]);
  const enrolled = session && me && (await Course.exists({ _id: session.courseId, 'roster.email': me.email }));
  if (!session || !enrolled) return { status: 404, body: { error: 'Session not found' } };
  if (session.status !== 'active') return { status: 409, body: { error: 'Session is not active' } };

  const reading = readReading(body);
  if (!reading) return { status: 400, body: { error: 'Invalid location' } };
  if (!isPreciseEnoughToCheckIn(reading.accuracy)) {
    return { status: 400, body: { error: 'Location too imprecise', maxAccuracyM: ATTENDANCE_RULES.studentMaxAccuracyM } };
  }
  const [lng, lat] = session.center.coordinates;
  const { distanceM, inRange } = evaluateRange(
    { lat: reading.lat, lng: reading.lng, accuracyM: reading.accuracy },
    { lat, lng, accuracyM: session.centerAccuracyM },
    session.radiusM,
  );
  return { session, reading, distanceM, inRange };
}

const isReply = (r: object): r is Reply => 'status' in r && 'body' in r;
const round1 = (m: number) => Math.round(m * 10) / 10;

/** Student: "am I in range?" — no side effects; the client calls it while watching location. */
sessionsRouter.post('/:id/range', requireRole('student'), async (req, res) => {
  const r = await checkStudentReading(String(req.params.id), req.auth!.sub, req.body);
  if (isReply(r)) {
    res.status(r.status).json(r.body);
    return;
  }
  const already = await Attendance.exists({ sessionId: r.session._id, studentId: req.auth!.sub });
  res.json({ inRange: r.inRange, distanceM: round1(r.distanceM), alreadyCheckedIn: !!already });
});

/** Student: "I'm here" — re-validates range with a fresh reading (≤ 30 s old) and records attendance once. */
sessionsRouter.post('/:id/check-in', requireRole('student'), async (req, res) => {
  const r = await checkStudentReading(String(req.params.id), req.auth!.sub, req.body);
  if (isReply(r)) {
    res.status(r.status).json(r.body);
    return;
  }
  if (!isFresh(r.reading.timestamp, Date.now())) {
    res.status(400).json({ error: 'Location reading too old', maxAgeMs: ATTENDANCE_RULES.readingMaxAgeMs });
    return;
  }
  if (!r.inRange) {
    res.status(403).json({ error: 'Not in range', distanceM: round1(r.distanceM) });
    return;
  }
  try {
    const a = await Attendance.create({
      sessionId: r.session._id,
      studentId: req.auth!.sub,
      checkedInAt: new Date(),
      distanceM: round1(r.distanceM),
      accuracyM: round1(r.reading.accuracy),
      source: 'gps',
    });
    res.status(201).json({ checkedInAt: a.checkedInAt, distanceM: a.distanceM });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      const existing = await Attendance.findOne({ sessionId: r.session._id, studentId: req.auth!.sub });
      res.status(409).json({ error: 'Already checked in', checkedInAt: existing?.checkedInAt });
      return;
    }
    throw e;
  }
});
