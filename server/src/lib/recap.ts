import type mongoose from 'mongoose';
import { config } from '../config.js';
import { Attendance, PRESENT } from '../models/Attendance.js';
import { LessonSummary } from '../models/LessonSummary.js';
import { Poll, PollResponse } from '../models/Poll.js';
import { Post } from '../models/Post.js';
import { aggregate } from './polls.js';
import { localNow } from './time.js';

interface SessionLike {
  _id: mongoose.Types.ObjectId;
  id: string;
  courseId: mongoose.Types.ObjectId;
  status: string;
  startsAt: Date;
  endsAt: Date;
}

/** One poll's outcome in a line: the leading answer (choice / yes-no), the average (scale), or a count (text). */
export function pollHeadline(poll: { type: string; options: { id: string; text: string }[] }, results: ReturnType<typeof aggregate>) {
  if (results.responses === 0) return null;
  if (results.counts) {
    const [topId, topCount] = Object.entries(results.counts).sort((a, b) => b[1] - a[1])[0] ?? [];
    const option = poll.options.find((o) => o.id === topId);
    return option ? { text: option.text, percent: Math.round((topCount / results.responses) * 100) } : null;
  }
  if (results.scale) return { text: `ממוצע ${results.scale.average}`, percent: null };
  return { text: `${results.texts?.length ?? 0} תשובות טקסט`, percent: null };
}

/**
 * Recap of the lecturer's most recent session, if it ended today (local time):
 * attendance, questions asked during it, and the polls opened during it.
 */
export async function lastLessonRecap(
  courses: { _id: mongoose.Types.ObjectId; id: string; name: string; roster: unknown[] }[],
  sessions: SessionLike[],
  now: Date,
) {
  const today = localNow(now, config.timeZone).date;
  const ended = sessions
    .filter((s) => s.endsAt.getTime() <= now.getTime() || s.status === 'closed')
    .filter((s) => localNow(s.endsAt, config.timeZone).date === today)
    .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());
  const session = ended[0];
  if (!session) return null;
  const course = courses.find((c) => String(c._id) === String(session.courseId));
  if (!course) return null;

  const [present, posts, polls, summary] = await Promise.all([
    Attendance.find({ sessionId: session._id, ...PRESENT }, { source: 1 }),
    Post.find({ sessionId: session._id, hidden: false }, { kind: 1, status: 1 }),
    Poll.find({ sessionId: session._id, status: { $ne: 'draft' } }).sort({ openedAt: 1 }),
    LessonSummary.findOne({ sessionId: session._id }, { status: 1 }).sort({ createdAt: -1 }),
  ]);
  const responses = await PollResponse.find({ pollId: { $in: polls.map((p) => p._id) } });
  const questions = posts.filter((p) => p.kind === 'question');

  return {
    courseId: course.id,
    courseName: course.name,
    sessionId: session.id,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    rosterCount: course.roster.length,
    present: present.length,
    manual: present.filter((a) => a.source === 'manual').length,
    questions: questions.length,
    unanswered: questions.filter((q) => q.status === 'open').length,
    suggestions: posts.length - questions.length,
    summary: summary ? { id: summary.id as string, status: summary.status } : null,
    polls: polls.map((p) => {
      const rs = responses.filter((r) => String(r.pollId) === String(p._id));
      const results = aggregate(p, rs.map((r) => ({ optionIds: r.optionIds ?? undefined, value: r.value ?? undefined, text: r.text ?? undefined })));
      return { id: p.id as string, question: p.question, responses: results.responses, top: pollHeadline(p, results) };
    }),
  };
}
