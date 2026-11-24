import { Router } from 'express';
import mongoose from 'mongoose';
import { ATTENDANCE_RULES, isPreciseEnoughToStart } from '../../../shared/attendance.js';
import { announceSessionStarted } from '../lib/push.js';
import { findAccessibleCourse, findOwnCourse } from '../lib/access.js';
import { buildCourseWorkbook } from '../lib/export.js';
import { isEmail, normalizeEmail, parseRosterFile } from '../lib/roster.js';
import { closeExpiredSessions, toPublicSession, toStudentSession } from '../lib/sessions.js';
import { readLocation } from '../lib/validate.js';
import { buildDashboard, buildStudentRows, isSessionActive } from '../lib/stats.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { config } from '../config.js';
import { Attendance, PRESENT } from '../models/Attendance.js';
import { Post } from '../models/Post.js';
import { exportPolls } from '../lib/pollExport.js';
import { pollSummary } from './polls.js';
import { countOpenQuestions } from './posts.js';
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

/** Course settings: name, radius and the roster (with signup status). Lecturer-only. */
coursesRouter.get('/:id/settings', requireRole('lecturer'), async (req, res) => {
  const course = await findOwnCourse(String(req.params.id), req.auth!.sub);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  res.json({ course: await settingsView(course) });
});

async function settingsView(course: NonNullable<Awaited<ReturnType<typeof findOwnCourse>>>) {
  const users = await User.find({ email: { $in: course.roster.map((r) => r.email) } }, { email: 1 });
  const registered = new Set(users.map((u) => u.email));
  const collator = new Intl.Collator('he');
  return {
    id: course.id as string,
    name: course.name,
    defaultRadiusM: course.defaultRadiusM,
    roster: course.roster
      .map((r) => ({ email: r.email, firstName: r.firstName, lastName: r.lastName, registered: registered.has(r.email) }))
      .sort((a, b) => collator.compare(a.lastName, b.lastName) || collator.compare(a.firstName, b.firstName)),
  };
}

/** Rename / change the default radius (used for future sessions). */
coursesRouter.patch('/:id', requireRole('lecturer'), async (req, res) => {
  const course = await findOwnCourse(String(req.params.id), req.auth!.sub);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const { name, defaultRadiusM } = (req.body ?? {}) as Record<string, unknown>;
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Course name is required' });
      return;
    }
    course.name = name.trim().slice(0, 120);
  }
  if (defaultRadiusM !== undefined) {
    const r = Number(defaultRadiusM);
    if (!Number.isFinite(r) || r < 5 || r > 500) {
      res.status(400).json({ error: 'Radius must be between 5 and 500 meters' });
      return;
    }
    course.defaultRadiusM = Math.round(r);
  }
  await course.save();
  res.json({ course: await settingsView(course) });
});

/** Add one student to the roster. */
coursesRouter.post('/:id/roster', requireRole('lecturer'), async (req, res) => {
  const course = await findOwnCourse(String(req.params.id), req.auth!.sub);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const { email, firstName, lastName } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof email !== 'string' || !isEmail(email)) {
    res.status(400).json({ error: 'Invalid email' });
    return;
  }
  const e = normalizeEmail(email);
  if (course.roster.some((r) => r.email === e)) {
    res.status(409).json({ error: 'Student already on roster' });
    return;
  }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 60) : '');
  course.roster.push({ email: e, firstName: str(firstName), lastName: str(lastName) });
  await course.save();
  res.status(201).json({ course: await settingsView(course) });
});

/** Remove a student from the roster (their past attendance stays in the database). */
coursesRouter.delete('/:id/roster/:email', requireRole('lecturer'), async (req, res) => {
  const course = await findOwnCourse(String(req.params.id), req.auth!.sub);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const e = normalizeEmail(String(req.params.email));
  const before = course.roster.length;
  course.set('roster', course.roster.filter((r) => r.email !== e));
  if (course.roster.length === before) {
    res.status(404).json({ error: 'Student not on roster' });
    return;
  }
  await course.save();
  res.json({ course: await settingsView(course) });
});

/**
 * Upload a roster file again. `merge` adds new students and updates names; `replace` also removes
 * students missing from the file.
 */
coursesRouter.put('/:id/roster', requireRole('lecturer'), async (req, res) => {
  const course = await findOwnCourse(String(req.params.id), req.auth!.sub);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const mode = (req.body as { mode?: unknown })?.mode === 'replace' ? 'replace' : 'merge';
  try {
    const parsed = await parseUpload(req.body);
    if (parsed.entries.length === 0) {
      res.status(400).json({ error: 'No valid emails found in the file' });
      return;
    }
    const existing = new Map(course.roster.map((r) => [r.email, { email: r.email, firstName: r.firstName, lastName: r.lastName }]));
    const incoming = new Map(parsed.entries.map((r) => [r.email, r]));
    let added = 0;
    let updated = 0;
    for (const [email, r] of incoming) {
      const old = existing.get(email);
      if (!old) added++;
      else if ((r.firstName && r.firstName !== old.firstName) || (r.lastName && r.lastName !== old.lastName)) updated++;
      existing.set(email, { email, firstName: r.firstName || old?.firstName || '', lastName: r.lastName || old?.lastName || '' });
    }
    let removed = 0;
    if (mode === 'replace') {
      for (const email of [...existing.keys()]) {
        if (!incoming.has(email)) {
          existing.delete(email);
          removed++;
        }
      }
    }
    course.set('roster', [...existing.values()]);
    await course.save();
    res.json({ added, updated, removed, skipped: parsed.skipped.length, course: await settingsView(course) });
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
    { sessionId: { $in: sessions.map((s) => s._id) }, ...PRESENT },
    { sessionId: 1, email: 1, checkedInAt: 1 },
  );
  const now = new Date();
  const students = buildStudentRows({
    roster: course.roster.map((r) => ({ email: r.email, firstName: r.firstName, lastName: r.lastName })),
    users: users.map((u) => ({ id: u.id as string, email: u.email })),
    sessions: sessions.map((s) => ({ id: s.id as string, status: s.status, endsAt: s.endsAt })),
    attendance: attendance.map((a) => ({ sessionId: String(a.sessionId), email: a.email, checkedInAt: a.checkedInAt })),
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
  const attendance = await Attendance.find({ sessionId: { $in: sessions.map((s) => s._id) }, ...PRESENT }, { sessionId: 1, email: 1 });
  const dashboard = buildDashboard({
    roster: course.roster.map((r) => ({ email: r.email, firstName: r.firstName, lastName: r.lastName })),
    users: users.map((u) => ({ id: u.id as string, email: u.email })),
    sessions: sessions.map((s) => ({ id: s.id as string, status: s.status, startsAt: s.startsAt, endsAt: s.endsAt })),
    attendance: attendance.map((a) => ({ sessionId: String(a.sessionId), email: a.email })),
    now: new Date(),
  });
  const [openQuestions, totalPosts, polls] = await Promise.all([
    countOpenQuestions(course._id),
    Post.countDocuments({ courseId: course._id, hidden: false }),
    pollSummary(course._id),
  ]);
  res.json({ course: { id: course.id, name: course.name, defaultRadiusM: course.defaultRadiusM }, ...dashboard, feed: { openQuestions, totalPosts }, polls });
});

/** All sessions of a course, newest first, with how many attended each. Lecturer-only. */
coursesRouter.get('/:id/sessions', requireRole('lecturer'), async (req, res) => {
  const course = await findOwnCourse(String(req.params.id), req.auth!.sub);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  await closeExpiredSessions({ courseId: course._id });
  const sessions = await Session.find({ courseId: course._id }, { status: 1, startsAt: 1, endsAt: 1 }).sort({ startsAt: -1 });
  const counts = await Attendance.aggregate<{ _id: mongoose.Types.ObjectId; n: number }>([
    { $match: { sessionId: { $in: sessions.map((s) => s._id) }, ...PRESENT } },
    { $group: { _id: '$sessionId', n: { $sum: 1 } } },
  ]);
  const presentById = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json({
    course: { id: course.id, name: course.name },
    rosterCount: course.roster.length,
    sessions: sessions.map((s) => ({ id: s.id as string, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, present: presentById.get(s.id) ?? 0 })),
  });
});

/** Attendance spreadsheet: summary sheet + one sheet per session. Lecturer-only. */
coursesRouter.get('/:id/export', requireRole('lecturer'), async (req, res) => {
  const course = await findOwnCourse(String(req.params.id), req.auth!.sub);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  await closeExpiredSessions({ courseId: course._id });
  const [users, sessions] = await Promise.all([
    User.find({ email: { $in: course.roster.map((r) => r.email) } }, { email: 1 }),
    Session.find({ courseId: course._id }, { status: 1, startsAt: 1, endsAt: 1 }),
  ]);
  const [records, posts, polls] = await Promise.all([
    Attendance.find({ sessionId: { $in: sessions.map((s) => s._id) } }),
    Post.find({ courseId: course._id }).sort({ createdAt: 1 }).populate('authorId', 'email'),
    exportPolls(course._id),
  ]);
  const now = new Date();
  const wb = buildCourseWorkbook({
    courseName: course.name,
    roster: course.roster.map((r) => ({ email: r.email, firstName: r.firstName, lastName: r.lastName })),
    users: users.map((u) => ({ id: u.id as string, email: u.email })),
    sessions: sessions.map((s) => ({ id: s.id as string, status: s.status, startsAt: s.startsAt, endsAt: s.endsAt })),
    records: records.map((r) => ({
      sessionId: String(r.sessionId),
      email: r.email,
      present: r.present,
      source: r.source,
      checkedInAt: r.checkedInAt,
      distanceM: r.distanceM,
      accuracyM: r.accuracyM,
    })),
    posts: posts.map((p) => ({
      createdAt: p.createdAt,
      kind: p.kind,
      text: p.text,
      authorEmail: (p.authorId as unknown as { email?: string } | null)?.email ?? '',
      anonymous: p.anonymous,
      votes: p.voterIds.length,
      status: p.status,
      pinned: p.pinned,
      hidden: p.hidden,
      duringClass: !!p.sessionId,
      reply: p.reply?.text ?? '',
    })),
    polls,
    now,
    timeZone: config.timeZone,
  });
  const date = now.toISOString().slice(0, 10);
  const name = `נוכחות - ${course.name} - ${date}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${date}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

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
  const me = await User.findById(req.auth!.sub, { email: 1 });
  const mine = session && me ? await Attendance.findOne({ sessionId: session._id, email: me.email }, { checkedInAt: 1, present: 1 }) : null;
  res.json({
    session: session ? toStudentSession(session) : null,
    courseName: course.name,
    myCheckIn: mine?.present ? { checkedInAt: mine.checkedInAt } : null,
    markedAbsent: mine ? !mine.present : false,
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
  announceSessionStarted({ id: course.id as string, name: course.name, roster: course.roster });
});
