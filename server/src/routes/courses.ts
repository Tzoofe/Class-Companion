import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { parseRosterFile } from '../lib/roster.js';
import { buildStudentRows, isSessionActive } from '../lib/stats.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { Attendance } from '../models/Attendance.js';
import { Course } from '../models/Course.js';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';

export const coursesRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

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

async function parseUpload(file: Express.Multer.File | undefined) {
  if (!file) throw new HttpError(400, 'Missing roster file');
  try {
    return await parseRosterFile(file.buffer, file.originalname);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

/** Parses a roster file without saving anything, so the lecturer can check it first. */
coursesRouter.post('/preview', requireRole('lecturer'), upload.single('file'), async (req, res) => {
  try {
    res.json(await parseUpload(req.file));
  } catch (e) {
    if (e instanceof HttpError) res.status(e.status).json({ error: e.message });
    else throw e;
  }
});

coursesRouter.post('/', requireRole('lecturer'), upload.single('file'), async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const radius = req.body?.defaultRadiusM ? Number(req.body.defaultRadiusM) : 20;
  if (!name) {
    res.status(400).json({ error: 'Course name is required' });
    return;
  }
  if (!Number.isFinite(radius) || radius < 5 || radius > 500) {
    res.status(400).json({ error: 'Radius must be between 5 and 500 meters' });
    return;
  }
  try {
    const parsed = await parseUpload(req.file);
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
  const id = String(req.params.id);
  const course = mongoose.isValidObjectId(id) ? await Course.findOne({ _id: id, lecturerId: req.auth!.sub }) : null;
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
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
