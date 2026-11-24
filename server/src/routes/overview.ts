import { Router } from 'express';
import { lastLessonRecap } from '../lib/recap.js';
import { closeExpiredSessions } from '../lib/sessions.js';
import { buildDashboard, isSessionActive } from '../lib/stats.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { Attendance, PRESENT } from '../models/Attendance.js';
import { Course } from '../models/Course.js';
import { Poll, PollResponse } from '../models/Poll.js';
import { Post } from '../models/Post.js';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';

/** Mounted at /api. */
export const overviewRouter = Router();

const TREND_SESSIONS = 8;
const WEEK_MS = 7 * 864e5;

/** Lecturer home: what's live now, per-course stats, and what needs attention — across all own courses. */
overviewRouter.get('/me/overview', requireAuth, requireRole('lecturer'), async (req, res) => {
  const courses = await Course.find({ lecturerId: req.auth!.sub }).sort({ createdAt: -1 });
  const courseIds = courses.map((c) => c._id);
  await closeExpiredSessions({ courseId: { $in: courseIds } });
  const now = new Date();

  const [sessions, users, openPolls, openQuestions] = await Promise.all([
    Session.find({ courseId: { $in: courseIds } }, { courseId: 1, status: 1, startsAt: 1, endsAt: 1 }),
    User.find({ email: { $in: [...new Set(courses.flatMap((c) => c.roster.map((r) => r.email)))] } }, { email: 1 }),
    Poll.find({ courseId: { $in: courseIds }, status: 'open' }, { courseId: 1, question: 1 }),
    Post.find({ courseId: { $in: courseIds }, kind: 'question', status: 'open', hidden: false }, { courseId: 1, text: 1, voterIds: 1, createdAt: 1 }),
  ]);
  const attendance = await Attendance.find({ sessionId: { $in: sessions.map((s) => s._id) }, ...PRESENT }, { sessionId: 1, email: 1, source: 1 });
  const pollAnswers = await PollResponse.aggregate<{ _id: unknown; n: number }>([
    { $match: { pollId: { $in: openPolls.map((p) => p._id) } } },
    { $group: { _id: '$pollId', n: { $sum: 1 } } },
  ]);
  const answersByPoll = new Map(pollAnswers.map((a) => [String(a._id), a.n]));
  const userList = users.map((u) => ({ id: u.id as string, email: u.email }));
  const name = new Map(courses.map((c) => [String(c._id), c.name]));

  const liveSessions: { courseId: string; courseName: string; sessionId: string; present: number; manual: number; rosterCount: number; endsAt: Date }[] = [];
  let weekPresent = 0;
  let weekPossible = 0;

  const courseCards = courses.map((c) => {
    const cs = sessions.filter((s) => String(s.courseId) === String(c._id));
    const ids = new Set(cs.map((s) => s.id as string));
    const att = attendance.filter((a) => ids.has(String(a.sessionId))).map((a) => ({ sessionId: String(a.sessionId), email: a.email, source: a.source }));
    const d = buildDashboard({
      roster: c.roster.map((r) => ({ email: r.email, firstName: r.firstName, lastName: r.lastName })),
      users: userList,
      sessions: cs.map((s) => ({ id: s.id as string, status: s.status, startsAt: s.startsAt, endsAt: s.endsAt })),
      attendance: att,
      now,
      attendanceRequired: c.attendanceRequired !== false,
    });
    if (d.live) liveSessions.push({ courseId: c.id, courseName: c.name, sessionId: d.live.id, present: d.live.present, manual: d.live.manual, rosterCount: c.roster.length, endsAt: d.live.endsAt });
    for (const h of d.history) {
      if (now.getTime() - h.startsAt.getTime() <= WEEK_MS) {
        weekPresent += h.present;
        weekPossible += c.roster.length;
      }
    }
    return {
      id: c.id as string,
      name: c.name,
      rosterCount: c.roster.length,
      registeredCount: d.registeredCount,
      sessionCount: d.sessionCount,
      averagePercent: d.averagePercent,
      lastSession: d.lastSession && { startsAt: d.lastSession.startsAt, present: d.lastSession.present, manual: d.lastSession.manual },
      live: d.live && { present: d.live.present, manual: d.live.manual },
      attendanceRequired: c.attendanceRequired !== false,
      trend: d.history.slice(-TREND_SESSIONS).map((h) => (c.roster.length ? Math.round((h.present / c.roster.length) * 100) : 0)),
      openQuestions: openQuestions.filter((p) => String(p.courseId) === String(c._id)).length,
      pollOpen: openPolls.some((p) => String(p.courseId) === String(c._id)),
      liveSession: !!d.live || cs.some((s) => isSessionActive(s, now)),
      atRiskCount: d.atRiskCount,
    };
  });

  const recap = liveSessions.length ? null : await lastLessonRecap(courses, sessions, now);

  res.json({
    recap,
    live: {
      sessions: liveSessions,
      polls: openPolls.map((p) => ({ courseId: String(p.courseId), courseName: name.get(String(p.courseId)) ?? '', pollId: p.id as string, question: p.question, responses: answersByPoll.get(p.id as string) ?? 0 })),
    },
    totals: {
      courses: courses.length,
      students: new Set(courses.flatMap((c) => c.roster.map((r) => r.email))).size,
      openQuestions: openQuestions.length,
      weekAttendancePercent: weekPossible ? Math.round((weekPresent / weekPossible) * 100) : null,
    },
    attention: {
      questions: openQuestions
        .map((p) => ({ courseId: String(p.courseId), courseName: name.get(String(p.courseId)) ?? '', postId: p.id as string, text: p.text, votes: p.voterIds.length, createdAt: p.createdAt }))
        .sort((a, b) => b.votes - a.votes || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5),
      atRisk: courseCards.filter((c) => c.atRiskCount > 0).map((c) => ({ courseId: c.id, courseName: c.name, count: c.atRiskCount })),
    },
    courses: courseCards,
  });
});
