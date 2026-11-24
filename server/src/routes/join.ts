import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { findOwnCourse } from '../lib/access.js';
import { hashPassword, signToken, verifyPassword } from '../lib/auth.js';
import { isEmail, normalizeEmail } from '../lib/roster.js';
import { addDays, localNow } from '../lib/time.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { Course } from '../models/Course.js';
import { User, toPublicUser } from '../models/User.js';

/** Mounted at /api: public /join/:code, lecturer /courses/:id/join… and /courses/demo. */
export const joinRouter = Router();

export const JOIN_LIMITS = { maxRoster: 300, nameMax: 40 } as const;

/** 6 characters, no look-alikes (0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newJoinCode() {
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

async function uniqueCode() {
  for (let i = 0; i < 10; i++) {
    const code = newJoinCode();
    if (!(await Course.exists({ joinCode: code }))) return code;
  }
  throw new Error('Could not create a join code');
}

const findByCode = (code: string) => Course.findOne({ joinCode: String(code).toUpperCase(), joinOpen: true });

/** What the join page shows before the form. Public. */
joinRouter.get('/join/:code', async (req, res) => {
  const course = await findByCode(req.params.code).populate('lecturerId', 'firstName lastName');
  if (!course) {
    res.status(404).json({ error: 'Join link not found or closed' });
    return;
  }
  const lec = course.lecturerId as unknown as { firstName: string; lastName: string } | null;
  res.json({ course: { id: course.id, name: course.name, lecturerName: lec ? `${lec.firstName} ${lec.lastName}`.trim() : '', demo: course.demo } });
});

/**
 * Join a course with its code: name + email (+ optional password for new accounts).
 * New email → a student account is created and signed in. Existing account → its password is required,
 * so nobody can get into someone else's account by typing their email.
 */
joinRouter.post('/join/:code', async (req, res) => {
  const course = await findByCode(req.params.code);
  if (!course) {
    res.status(404).json({ error: 'Join link not found or closed' });
    return;
  }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const firstName = typeof b.firstName === 'string' ? b.firstName.trim().slice(0, JOIN_LIMITS.nameMax) : '';
  const lastName = typeof b.lastName === 'string' ? b.lastName.trim().slice(0, JOIN_LIMITS.nameMax) : '';
  const email = typeof b.email === 'string' ? normalizeEmail(b.email) : '';
  const password = typeof b.password === 'string' ? b.password : '';
  if (!firstName) {
    res.status(400).json({ error: 'First name is required' });
    return;
  }
  if (!isEmail(email)) {
    res.status(400).json({ error: 'Invalid email' });
    return;
  }

  let user = await User.findOne({ email });
  if (user) {
    if (!password) {
      res.status(409).json({ error: 'This email already has an account', needsPassword: true });
      return;
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: 'Wrong email or password', needsPassword: true });
      return;
    }
    if (user.role !== 'student') {
      res.status(403).json({ error: 'Lecturer accounts cannot join as students' });
      return;
    }
  } else {
    if (password && password.length < config.minPasswordLength) {
      res.status(400).json({ error: `Password must be at least ${config.minPasswordLength} characters` });
      return;
    }
    user = await User.create({
      email,
      // No password given: a random one (they stay signed in on this device; "forgot password" isn't built).
      passwordHash: await hashPassword(password || randomBytes(18).toString('base64url')),
      role: 'student',
      firstName,
      lastName,
    });
  }

  if (!course.roster.some((r) => r.email === email)) {
    if (course.roster.length >= JOIN_LIMITS.maxRoster) {
      res.status(409).json({ error: 'The course is full' });
      return;
    }
    // Atomic add, so two people joining at the same moment don't overwrite each other.
    await Course.updateOne({ _id: course._id, 'roster.email': { $ne: email } }, { $push: { roster: { email, firstName, lastName, joinedAt: new Date() } } });
  }
  res.status(201).json({ token: signToken({ sub: user.id, role: 'student' }), user: toPublicUser(user), courseId: course.id });
});

/** Lecturer: open/close the join link, or get a new code (the old QR stops working). */
joinRouter.post('/courses/:id/join', requireAuth, requireRole('lecturer'), async (req, res) => {
  const course = await findOwnCourse(String(req.params.id), req.auth!.sub);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const { open, regenerate } = (req.body ?? {}) as { open?: unknown; regenerate?: unknown };
  if (open !== undefined && typeof open !== 'boolean') {
    res.status(400).json({ error: 'Invalid setting' });
    return;
  }
  if (regenerate === true || (open === true && !course.joinCode)) course.joinCode = await uniqueCode();
  if (typeof open === 'boolean') course.joinOpen = open;
  await course.save();
  res.json({ joinCode: course.joinCode ?? null, joinOpen: course.joinOpen });
});

/** Lecturer: join status and who joined with the link (newest first), for the join screen. */
joinRouter.get('/courses/:id/join', requireAuth, requireRole('lecturer'), async (req, res) => {
  const course = await findOwnCourse(String(req.params.id), req.auth!.sub);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const joined = course.roster
    .filter((r) => r.joinedAt)
    .sort((a, b) => b.joinedAt!.getTime() - a.joinedAt!.getTime())
    .map((r) => ({ firstName: r.firstName, lastName: r.lastName, joinedAt: r.joinedAt }));
  res.json({ course: { id: course.id, name: course.name, demo: course.demo }, joinCode: course.joinCode ?? null, joinOpen: course.joinOpen, rosterCount: course.roster.length, joined });
});

/**
 * One click demo: an empty course with the join link open and a lesson happening now (so "today",
 * check-in and the recap work immediately).
 */
joinRouter.post('/courses/demo', requireAuth, requireRole('lecturer'), async (req, res) => {
  const now = localNow(new Date(), config.timeZone);
  const [h, m] = now.time.split(':').map(Number);
  const start = `${String(h).padStart(2, '0')}:${String(Math.floor(m / 15) * 15).padStart(2, '0')}`;
  const endH = Math.min(h + 2, 23);
  const course = await Course.create({
    name: `קורס הדגמה · ${now.date.split('-').reverse().slice(0, 2).join('.')}`,
    lecturerId: req.auth!.sub,
    roster: [],
    demo: true,
    joinOpen: true,
    joinCode: await uniqueCode(),
    attendanceRequired: false,
    schedule: [{ id: 'demo', weekday: now.weekday, start, end: `${String(endH).padStart(2, '0')}:${endH === 23 ? '59' : start.slice(3)}`, title: 'שיעור הדגמה', place: '' }],
    semesterStart: now.date,
    semesterEnd: addDays(now.date, 1),
  });
  res.status(201).json({ course: { id: course.id, name: course.name, joinCode: course.joinCode } });
});
