import { Router } from 'express';
import mongoose from 'mongoose';
import { ATTENDANCE_RULES, isPreciseEnoughToStart } from '../../../shared/attendance.js';
import { parseRosterFile } from '../lib/roster.js';
import { closeExpiredSessions, toPublicSession, toStudentSession } from '../lib/sessions.js';
import { readLocation } from '../lib/validate.js';
import { buildDashboard, buildStudentRows, isSessionActive } from '../lib/stats.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { Attendance } from '../models/Attendance.js';
import { Course } from '../models/Course.js';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';

export const coursesRouter = Router();
/** Roster files arrive as base64 in JSON ({ fileName, fileBase64 }) — works the same locally and on Cloud Functions. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

coursesRouter.use(requireAuth);

coursesRouter.get('/', async (req, res) => {
  const { sub, role } = req.auth!;
  if (role === 'lecturer') {
    const courses = await Course.find({ lecturerId: sub }).sort({ createdAt: -1 });
    res.json({
      courses: courses.map((c) => ({
        id: c.id,
        name: c.name,
        rosterCount: c.roster.length,
        defaultRadiusM: c.defaultRadiusM,
      })),
    });
    return;
  }
  const me = await User.findById(sub);
  const courses = me ? await Course.find({ 'roster.email': me.email }).populate('lecturerId', 'firstName lastName') : [];
  res.json({
    courses: courses.map((c) => {
      const lec = c.lecturerId as unknown as { firstName: string; lastName: string } | null;
      return { id: c.id, name: c.name, lecturerName: lec ? `${lec.firstName} ${lec.lastName}`.trim() : '' };
    }),
  });
});

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parseUpload(body: unknown) {
  const { fileName, fileBase64 } = (body ?? {}) as Record<string, unknown>;
  if (typeof fileName !== 'string' || typeof fileBase64 !== 'string' || !fileBase64) {
    throw new HttpError(400, 'Missing roster file');
  }
  const buffer = Buffer.from(fileBase64, 'base64');
  if (buffer.length > MAX_FILE_BYTES) throw new HttpError(400, 'File too large (max 2 MB)');
  try {
    return await parseRosterFile(buffer, fileName);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

/** Parses a roster file without saving anything, so the lecturer can check it first. */
coursesRouter.post('/preview', requireRole('lecturer'), async (req, res) => {
  try {
    res.json(await parseUpload(req.body));
  } catch (e) {
    if (e instanceof HttpError) res.status(e.status).json({ error: e.message });
    else throw e;
  }
});

coursesRouter.post('/', requireRole('lecturer'), async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const rawRadius = req.body?.defaultRadiusM;
  const radius = rawRadius === undefined || rawRadius === '' ? ATTENDANCE_RULES.defaultRadiusM : Number(rawRadius);
  if (!name) {
    res.status(400).json({ error: 'Course name is required' });
    return;
  }
  if (!Number.isFinite(radius) || radius < 5 || radius > 500) {
    res.status(400).json({ error: 'Radius must be between 5 and 500 meters' });
    return;
  }
  try {
    const parsed = await parseUpload(req.body);
    if (parsed.entries.length === 0) {
      res.status(400).json({ error: 'No valid emails found in the file' });
      return;
    }
    const course = await Course.create({ name, lecturerId: req.auth!.sub, roster: parsed.entries, defaultRadiusM: radius });
    res.status(201).json({ course: { id: course.id, name: course.name, rosterCount: course.roster.length, defaultRadiusM: radius } });
  } catch (e) {
    if (e instanceof HttpError) res.status(e.status).json({ error: e.message });
    else throw e;
  }
});

/** Roster with per-student attendance stats. Lecturer-only; other lecturers' courses look like 404. */
coursesRouter.get('/:id/students', requireRole('lecturer'), async (req, res) => {
  const course = await findOwnCourse(String(req.params.id), req.auth!.sub);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  await closeExpiredSessions({ courseId: course._id });
  const emails = course.roster.map((r) => r.email);
  const [users, sessions] = await Promise.all([
    User.find({ email: { $in: emails } }, { email: 1 }),
    Session.find({ courseId: course._id }, { status: 1, endsAt: 1 }),
  ]);
  const attendance = await Attendance.find(
    { sessionId: { $in: sessions.map((s) => s._id) } },
    { sessionId: 1, studentId: 1, checkedInAt: 1 },
  );
  const now = new Date();
  const students = buildStudentRows({
    roster: course.roster.map((r) => ({ email: r.email, firstName: r.firstName, lastName: r.lastName })),
    users: users.map((u) => ({ id: u.id as string, email: u.email })),
    sessions: sessions.map((s) => ({ id: s.id as string, status: s.status, endsAt: s.endsAt })),
    attendance: attendance.map((a) => ({ sessionId: String(a.sessionId), studentId: String(a.studentId), checkedInAt: a.checkedInAt })),
    now,
  });
  const active = sessions.find((s) => isSessionActive(s, now));
  res.json({
    course: {
      id: course.id,
      name: course.name,
      defaultRadiusM: course.defaultRadiusM,
      rosterCount: course.roster.length,
      registeredCount: students.filter((s) => s.registered).length,
      sessionCount: sessions.length,
      activeSessionId: active?.id ?? null,
    },
    students,
  });
});

/** Course dashboard: headline numbers, attendance per session, students who need attention. Lecturer-only. */
coursesRouter.get('/:id/dashboard', requireRole('lecturer'), async (req, res) => {
  const course = await findOwnCourse(String(req.params.id), req.auth!.sub);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  await closeExpiredSessions({ courseId: course._id });
  const emails = course.roster.map((r) => r.email);
  const [users, sessions] = await Promise.all([
    User.find({ email: { $in: emails } }, { email: 1 }),
    Session.find({ courseId: course._id }, { status: 1, startsAt: 1, endsAt: 1 }),
  ]);
  const attendance = await Attendance.find({ sessionId: { $in: sessions.map((s) => s._id) } }, { sessionId: 1, studentId: 1 });
  const dashboard = buildDashboard({
    roster: course.roster.map((r) => ({ email: r.email, firstName: r.firstName, lastName: r.lastName })),
    users: users.map((u) => ({ id: u.id as string, email: u.email })),
    sessions: sessions.map((s) => ({ id: s.id as string, status: s.status, startsAt: s.startsAt, endsAt: s.endsAt })),
    attendance: attendance.map((a) => ({ sessionId: String(a.sessionId), studentId: String(a.studentId) })),
    now: new Date(),
  });
  res.json({ course: { id: course.id, name: course.name, defaultRadiusM: course.defaultRadiusM }, ...dashboard });
});

function findOwnCourse(id: string, lecturerId: string) {
  return mongoose.isValidObjectId(id) ? Course.findOne({ _id: id, lecturerId }) : Promise.resolve(null);
}

/** Lecturer: own course. Student: course whose roster lists their email. */
async function findAccessibleCourse(id: string, auth: { sub: string; role: string }) {
  if (!mongoose.isValidObjectId(id)) return null;
  if (auth.role === 'lecturer') return Course.findOne({ _id: id, lecturerId: auth.sub });
  const me = await User.findById(auth.sub, { email: 1 });
  return me ? Course.findOne({ _id: id, 'roster.email': me.email }) : null;
}

/** The course's currently active session, or null. */
coursesRouter.get('/:id/sessions/active', async (req, res) => {
  const course = await findAccessibleCourse(String(req.params.id), req.auth!);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  await closeExpiredSessions({ courseId: course._id });
  const session = await Session.findOne({ courseId: course._id, status: 'active' });
  if (req.auth!.role === 'lecturer') {
    res.json({ session: session ? toPublicSession(session) : null, serverNow: new Date() });
    return;
  }
  const mine = session ? await Attendance.findOne({ sessionId: session._id, studentId: req.auth!.sub }, { checkedInAt: 1 }) : null;
  res.json({
    session: session ? toStudentSession(session) : null,
    courseName: course.name,
    myCheckIn: mine ? { checkedInAt: mine.checkedInAt } : null,
    serverNow: new Date(),
  });
});

/** Start an attendance session centered on the lecturer's (precise) location. */
coursesRouter.post('/:id/sessions', requireRole('lecturer'), async (req, res) => {
  const course = await findOwnCourse(String(req.params.id), req.auth!.sub);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const loc = readLocation(req.body);
  if (!loc) {
    res.status(400).json({ error: 'Invalid location' });
    return;
  }
  if (!isPreciseEnoughToStart(loc.accuracy)) {
    res.status(400).json({ error: 'Location not precise enough', maxAccuracyM: ATTENDANCE_RULES.lecturerMaxAccuracyM });
    return;
  }
  await closeExpiredSessions({ courseId: course._id });
  const existing = await Session.findOne({ courseId: course._id, status: 'active' });
  if (existing) {
    res.status(409).json({ error: 'A session is already active', session: toPublicSession(existing) });
    return;
  }
  const now = new Date();
  const session = await Session.create({
    courseId: course._id,
    center: { type: 'Point', coordinates: [loc.lng, loc.lat] },
    centerAccuracyM: loc.accuracy,
    radiusM: course.defaultRadiusM,
    startsAt: now,
    endsAt: new Date(now.getTime() + ATTENDANCE_RULES.defaultSessionMinutes * 60_000),
    status: 'active',
  });
  res.status(201).json({ session: toPublicSession(session) });
});
