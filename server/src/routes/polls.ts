import { Router } from 'express';
import mongoose from 'mongoose';
import { findAccessibleCourse } from '../lib/access.js';
import { aggregate, readPollInput, readResponse, type PollResults } from '../lib/polls.js';
import { notifyInBackground } from '../lib/push.js';
import { closeExpiredSessions } from '../lib/sessions.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { Attendance, PRESENT } from '../models/Attendance.js';
import { Poll, PollResponse, type PollDoc } from '../models/Poll.js';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';

/** Mounted at /api: /courses/:id/polls… and /polls/:pollId… */
export const pollsRouter = Router();

type Viewer = { sub: string; role: string };
type CourseLike = { _id: mongoose.Types.ObjectId; id: string; name: string; roster: { email: string }[] };

async function resultsFor(polls: PollDoc[]) {
  const responses = await PollResponse.find({ pollId: { $in: polls.map((p) => p._id) } }).sort({ updatedAt: -1 });
  const byPoll = new Map<string, typeof responses>();
  for (const r of responses) byPoll.set(String(r.pollId), [...(byPoll.get(String(r.pollId)) ?? []), r]);
  return byPoll;
}

/** Emails allowed to answer: the roster, or those present in the poll's session. */
async function eligibleEmails(poll: PollDoc, course: CourseLike): Promise<Set<string>> {
  const roster = new Set(course.roster.map((r) => r.email.toLowerCase()));
  if (poll.audience !== 'present') return roster;
  if (!poll.sessionId) return new Set();
  const present = await Attendance.find({ sessionId: poll.sessionId, ...PRESENT }, { email: 1 });
  return new Set(present.map((a) => a.email).filter((e) => roster.has(e)));
}

function baseView(p: PollDoc) {
  return {
    id: p.id as string,
    question: p.question,
    type: p.type,
    multiple: p.multiple,
    options: p.options.map((o) => ({ id: o.id, text: o.text })),
    audience: p.audience,
    status: p.status,
    resultsRevealed: p.resultsRevealed,
    openedAt: p.openedAt ?? null,
    closedAt: p.closedAt ?? null,
    createdAt: p.createdAt,
  };
}

function lecturerView(p: PollDoc, results: PollResults, eligible: number) {
  return { ...baseView(p), correctOptionIds: p.correctOptionIds, showTextOnScreen: p.showTextOnScreen, results, eligible };
}

function answerOf(r: { optionIds?: string[] | null; value?: number | null; text?: string | null } | undefined) {
  if (!r) return null;
  return { optionIds: r.optionIds ?? undefined, value: r.value ?? undefined, text: r.text ?? undefined };
}

/** Students get results and the correct answer only once revealed. */
function studentView(p: PollDoc, results: PollResults, mine: ReturnType<typeof answerOf>, canAnswer: boolean) {
  const revealed = p.resultsRevealed;
  return {
    ...baseView(p),
    canAnswer: canAnswer && p.status === 'open',
    eligible: canAnswer,
    myAnswer: mine,
    results: revealed ? results : null,
    correctOptionIds: revealed ? p.correctOptionIds : [],
  };
}

async function viewsFor(polls: PollDoc[], course: CourseLike, viewer: Viewer) {
  const byPoll = await resultsFor(polls);
  const me = viewer.role === 'student' ? await User.findById(viewer.sub, { email: 1 }) : null;
  return Promise.all(
    polls.map(async (p) => {
      const rs = byPoll.get(String(p._id)) ?? [];
      const results = aggregate(p, rs.map((r) => answerOf(r)!));
      const eligible = await eligibleEmails(p, course);
      if (viewer.role === 'lecturer') return lecturerView(p, results, eligible.size);
      const mine = rs.find((r) => r.email === me?.email);
      return studentView(p, results, answerOf(mine), !!me && eligible.has(me.email));
    }),
  );
}

async function loadCourse(req: import('express').Request) {
  return findAccessibleCourse(String(req.params.id), req.auth!);
}

/** Lecturer: all polls (drafts too). Student: opened polls. Newest first; the open poll first. */
pollsRouter.get('/courses/:id/polls', requireAuth, async (req, res) => {
  const course = await loadCourse(req);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const query = Poll.find({ courseId: course._id });
  if (req.auth!.role !== 'lecturer') query.where('status').ne('draft');
  const polls = await query.sort({ createdAt: -1 }).limit(200);
  polls.sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'));
  res.json({ course: { id: course.id, name: course.name }, polls: await viewsFor(polls, course, req.auth!) });
});

/** Light check for "is a poll open?" banners. */
pollsRouter.get('/courses/:id/polls/active', requireAuth, async (req, res) => {
  const course = await loadCourse(req);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const poll = await Poll.findOne({ courseId: course._id, status: 'open' });
  if (!poll) {
    res.json({ poll: null });
    return;
  }
  let answered = false;
  let canAnswer = true;
  if (req.auth!.role === 'student') {
    const me = await User.findById(req.auth!.sub, { email: 1 });
    answered = !!me && !!(await PollResponse.exists({ pollId: poll._id, email: me.email }));
    canAnswer = !!me && (await eligibleEmails(poll, course)).has(me.email);
  }
  res.json({ poll: { id: poll.id, question: poll.question, answered, canAnswer } });
});

/** Opens a poll: closes any other open poll of the course, records the active session, notifies students. */
async function openPoll(poll: PollDoc, course: CourseLike): Promise<{ error: string; status: number } | null> {
  await closeExpiredSessions({ courseId: course._id });
  const session = await Session.findOne({ courseId: course._id, status: 'active' }, { _id: 1 });
  if (poll.audience === 'present' && !session) return { status: 409, error: 'Attendance is not open' };
  const now = new Date();
  await Poll.updateMany({ courseId: course._id, status: 'open', _id: { $ne: poll._id } }, { $set: { status: 'closed', closedAt: now } });
  poll.status = 'open';
  poll.openedAt = poll.openedAt ?? now;
  poll.set('closedAt', undefined);
  // Keep the original session when reopening a "present only" poll.
  if (!poll.sessionId || poll.audience !== 'present') poll.sessionId = session?._id as mongoose.Types.ObjectId | undefined;
  await poll.save();

  const emails = [...(await eligibleEmails(poll, course))];
  const students = await User.find({ email: { $in: emails }, role: 'student' }, { _id: 1 });
  notifyInBackground(
    students.map((u) => String(u._id)),
    { title: `סקר חדש · ${course.name}`, body: poll.question.slice(0, 140), url: `/courses/${course.id}/polls`, tag: `poll-${course.id}` },
    30 * 60,
  );
  return null;
}

/** Create a poll (draft), or create and open it at once with { open: true }. */
pollsRouter.post('/courses/:id/polls', requireAuth, requireRole('lecturer'), async (req, res) => {
  const course = await loadCourse(req);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const input = readPollInput(req.body);
  if ('error' in input) {
    res.status(400).json(input);
    return;
  }
  const poll = new Poll({ courseId: course._id, ...input });
  if ((req.body as { open?: unknown })?.open === true) {
    const failed = await openPoll(poll, course);
    if (failed) {
      res.status(failed.status).json({ error: failed.error });
      return;
    }
  } else {
    await poll.save();
  }
  res.status(201).json({ poll: (await viewsFor([poll], course, req.auth!))[0] });
});

async function findPoll(pollId: string, viewer: Viewer) {
  if (!mongoose.isValidObjectId(pollId)) return null;
  const poll = await Poll.findById(pollId);
  if (!poll) return null;
  const course = await findAccessibleCourse(String(poll.courseId), viewer);
  if (!course) return null;
  if (viewer.role !== 'lecturer' && poll.status === 'draft') return null;
  return { poll, course };
}

const lecturerAction =
  (action: (poll: PollDoc, course: CourseLike, body: Record<string, unknown>) => Promise<{ status: number; error: string } | null | 'deleted'>) =>
  async (req: import('express').Request, res: import('express').Response) => {
    const found = await findPoll(String(req.params.pollId), req.auth!);
    if (!found) {
      res.status(404).json({ error: 'Poll not found' });
      return;
    }
    const result = await action(found.poll, found.course, (req.body ?? {}) as Record<string, unknown>);
    if (result === 'deleted') {
      res.json({ ok: true });
      return;
    }
    if (result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ poll: (await viewsFor([found.poll], found.course, req.auth!))[0] });
  };

/** Edit a draft. */
pollsRouter.put(
  '/polls/:pollId',
  requireAuth,
  requireRole('lecturer'),
  lecturerAction(async (poll, _course, body) => {
    if (poll.status !== 'draft') return { status: 409, error: 'Only drafts can be edited' };
    const input = readPollInput(body);
    if ('error' in input) return { status: 400, error: input.error };
    poll.set(input);
    await poll.save();
    return null;
  }),
);

pollsRouter.post('/polls/:pollId/open', requireAuth, requireRole('lecturer'), lecturerAction((poll, course) => openPoll(poll, course)));

pollsRouter.post(
  '/polls/:pollId/close',
  requireAuth,
  requireRole('lecturer'),
  lecturerAction(async (poll) => {
    if (poll.status === 'open') {
      poll.status = 'closed';
      poll.closedAt = new Date();
      await poll.save();
    }
    return null;
  }),
);

/** Show / hide results (and the correct answer) to students. */
pollsRouter.post(
  '/polls/:pollId/reveal',
  requireAuth,
  requireRole('lecturer'),
  lecturerAction(async (poll, _course, body) => {
    if (typeof body.revealed !== 'boolean') return { status: 400, error: 'Expected { revealed }' };
    if (poll.status === 'draft') return { status: 409, error: 'Poll was not opened yet' };
    poll.resultsRevealed = body.revealed;
    await poll.save();
    return null;
  }),
);

pollsRouter.delete(
  '/polls/:pollId',
  requireAuth,
  requireRole('lecturer'),
  lecturerAction(async (poll) => {
    await PollResponse.deleteMany({ pollId: poll._id });
    await poll.deleteOne();
    return 'deleted';
  }),
);

/** Copy a poll as a new draft (reuse a question in another lesson). */
pollsRouter.post('/polls/:pollId/duplicate', requireAuth, requireRole('lecturer'), async (req, res) => {
  const found = await findPoll(String(req.params.pollId), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Poll not found' });
    return;
  }
  const p = found.poll;
  const copy = await Poll.create({
    courseId: p.courseId,
    question: p.question,
    type: p.type,
    multiple: p.multiple,
    options: p.options.map((o) => ({ id: o.id, text: o.text })),
    correctOptionIds: p.correctOptionIds,
    audience: p.audience,
    showTextOnScreen: p.showTextOnScreen,
  });
  res.status(201).json({ poll: (await viewsFor([copy], found.course, req.auth!))[0] });
});

/** Student answers (or changes their answer) while the poll is open. */
pollsRouter.put('/polls/:pollId/response', requireAuth, requireRole('student'), async (req, res) => {
  const found = await findPoll(String(req.params.pollId), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Poll not found' });
    return;
  }
  const { poll, course } = found;
  if (poll.status !== 'open') {
    res.status(409).json({ error: 'Poll is closed' });
    return;
  }
  const me = await User.findById(req.auth!.sub, { email: 1 });
  if (!me || !(await eligibleEmails(poll, course)).has(me.email)) {
    res.status(403).json({ error: 'Only students present in class can answer' });
    return;
  }
  const answer = readResponse(poll, req.body);
  if ('error' in answer) {
    res.status(400).json(answer);
    return;
  }
  await PollResponse.updateOne(
    { pollId: poll._id, email: me.email },
    { $set: { studentId: me._id, optionIds: answer.optionIds, value: answer.value, text: answer.text } },
    { upsert: true },
  );
  res.json({ poll: (await viewsFor([poll], course, req.auth!))[0] });
});

/** For the dashboard and export. */
export async function pollSummary(courseId: mongoose.Types.ObjectId) {
  const [open, total] = await Promise.all([Poll.findOne({ courseId, status: 'open' }, { question: 1 }), Poll.countDocuments({ courseId, status: { $ne: 'draft' } })]);
  return { open: open ? { id: open.id as string, question: open.question } : null, total };
}
