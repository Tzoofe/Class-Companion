import { Router } from 'express';
import { config } from '../config.js';
import { hashPassword, signToken, verifyPassword } from '../lib/auth.js';
import { isEmail, normalizeEmail } from '../lib/roster.js';
import { requireAuth } from '../middleware/auth.js';
import { Course } from '../models/Course.js';
import { User, toPublicUser } from '../models/User.js';

export const authRouter = Router();

function readCredentials(body: unknown): { email: string; password: string } | null {
  const { email, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string') return null;
  return { email: normalizeEmail(email), password };
}

/** What the signup form needs to know (allowed email domains). */
authRouter.get('/signup-config', (_req, res) => {
  res.json({ domains: config.signupDomains });
});

/** Student self-signup: university email (config.signupDomains) or an email listed on a course roster. Name is taken from the first course roster that lists the email. */
authRouter.post('/signup', async (req, res) => {
  const creds = readCredentials(req.body);
  if (!creds || !isEmail(creds.email)) {
    res.status(400).json({ error: 'Invalid email' });
    return;
  }
  // University email, or any email a lecturer put on a course roster.
  const domains = config.signupDomains;
  const onRoster = await Course.exists({ 'roster.email': creds.email });
  if (domains.length && !domains.includes(creds.email.split('@')[1]) && !onRoster) {
    res.status(400).json({ error: 'Use your university email', domains });
    return;
  }
  if (creds.password.length < config.minPasswordLength) {
    res.status(400).json({ error: `Password must be at least ${config.minPasswordLength} characters` });
    return;
  }
  if (await User.exists({ email: creds.email })) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }
  const course = await Course.findOne({ 'roster.email': creds.email }, { roster: { $elemMatch: { email: creds.email } } });
  const entry = course?.roster[0];
  const user = await User.create({
    email: creds.email,
    passwordHash: await hashPassword(creds.password),
    role: 'student',
    firstName: entry?.firstName ?? '',
    lastName: entry?.lastName ?? '',
  });
  res.status(201).json({ token: signToken({ sub: user.id, role: 'student' }), user: toPublicUser(user) });
});

authRouter.post('/login', async (req, res) => {
  const creds = readCredentials(req.body);
  const user = creds ? await User.findOne({ email: creds.email }) : null;
  if (!creds || !user || !(await verifyPassword(creds.password, user.passwordHash))) {
    res.status(401).json({ error: 'Wrong email or password' });
    return;
  }
  res.json({ token: signToken({ sub: user.id, role: user.role }), user: toPublicUser(user) });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.auth!.sub);
  if (!user) {
    res.status(401).json({ error: 'Not logged in' });
    return;
  }
  res.json({ user: toPublicUser(user) });
});
