import { Router } from 'express';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { findAccessibleCourse, findOwnCourse } from '../lib/access.js';
import { notifyCourseStudents } from '../lib/push.js';
import { buildAgenda, describeEvent, readEvent, readSlots, type Slot } from '../lib/schedule.js';
import { addDays, isDate, localNow } from '../lib/time.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { Course } from '../models/Course.js';
import { Assignment } from '../models/Assignment.js';
import { CourseEvent, type CourseEventDoc } from '../models/CourseEvent.js';
import { User } from '../models/User.js';

/** Mounted at /api: course schedule & events, and the personal agenda (/me/agenda). */
export const scheduleRouter = Router();

const slotsOf = (c: { schedule: Slot[] }) => c.schedule.map((s) => ({ id: s.id, weekday: s.weekday, start: s.start, end: s.end, title: s.title, place: s.place }));

function eventView(e: CourseEventDoc) {
  return {
    id: e.id as string,
    courseId: String(e.courseId),
    kind: e.kind,
    date: e.date,
    start: e.start ?? null,
    end: e.end ?? null,
    title: e.title,
    place: e.place,
    link: e.link,
    notes: e.notes,
    slotId: e.slotId ?? null,
  };
}

/** Courses the user takes part in (lecturer: own; student: roster lists their email). */
async function myCourses(auth: { sub: string; role: string }) {
  if (auth.role === 'lecturer') return Course.find({ lecturerId: auth.sub });
  const me = await User.findById(auth.sub, { email: 1 });
  return me ? Course.find({ 'roster.email': me.email }) : [];
}

/** Personal agenda: classes and events of all my courses. `?from=YYYY-MM-DD&days=7` (default today, 7 days). */
scheduleRouter.get('/me/agenda', requireAuth, async (req, res) => {
  const now = localNow(new Date(), config.timeZone);
  const from = isDate(req.query.from) ? req.query.from : now.date;
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 31);
  const courses = await myCourses(req.auth!);
  const events = await CourseEvent.find({ courseId: { $in: courses.map((c) => c._id) }, date: { $gte: from, $lte: addDays(from, days - 1) } });
  const items = buildAgenda(
    courses.map((c) => ({ id: c.id as string, name: c.name, schedule: slotsOf(c), semesterStart: c.semesterStart, semesterEnd: c.semesterEnd })),
    events.map((e) => ({ ...eventView(e), start: e.start ?? undefined, end: e.end ?? undefined, slotId: e.slotId ?? undefined })),
    from,
    days,
  );
  // Assignment due dates (published ones) appear in the agenda too.
  const to = addDays(from, days - 1);
  const assignments = await Assignment.find({ courseId: { $in: courses.map((c) => c._id) }, status: 'published' }, { courseId: 1, title: 1, dueAt: 1 });
  const courseName = new Map(courses.map((c) => [String(c._id), c.name]));
  for (const a of assignments) {
    const due = localNow(a.dueAt, config.timeZone);
    if (due.date < from || due.date > to) continue;
    items.push({ date: due.date, start: due.time, end: null, courseId: String(a.courseId), courseName: courseName.get(String(a.courseId)) ?? '', kind: 'due', title: a.title, place: '', link: '', notes: '', cancelled: false, eventId: a.id as string });
  }
  items.sort((x, y) => x.date.localeCompare(y.date) || x.start.localeCompare(y.start));
  res.json({ now, from, days, items, hasSchedule: courses.some((c) => c.schedule.length > 0) || assignments.length > 0 });
});

/** A course's weekly slots and upcoming events (course members). */
scheduleRouter.get('/courses/:id/schedule', requireAuth, async (req, res) => {
  const course = await findAccessibleCourse(String(req.params.id), req.auth!);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const today = localNow(new Date(), config.timeZone).date;
  const events = await CourseEvent.find({ courseId: course._id, date: { $gte: addDays(today, -30) } }).sort({ date: 1, start: 1 });
  res.json({
    course: { id: course.id, name: course.name },
    schedule: slotsOf(course),
    semesterStart: course.semesterStart ?? null,
    semesterEnd: course.semesterEnd ?? null,
    events: events.map(eventView),
    today,
  });
});

/** Replace the weekly slots and/or semester dates. Students are told when class times change. */
scheduleRouter.put('/courses/:id/schedule', requireAuth, requireRole('lecturer'), async (req, res) => {
  const course = await findOwnCourse(String(req.params.id), req.auth!.sub);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const slots = readSlots(b.schedule);
  if ('error' in slots) {
    res.status(400).json(slots);
    return;
  }
  for (const k of ['semesterStart', 'semesterEnd'] as const) {
    if (b[k] !== undefined && b[k] !== null && b[k] !== '' && !isDate(b[k])) {
      res.status(400).json({ error: 'Invalid date' });
      return;
    }
  }
  const start = isDate(b.semesterStart) ? b.semesterStart : undefined;
  const end = isDate(b.semesterEnd) ? b.semesterEnd : undefined;
  if (start && end && end < start) {
    res.status(400).json({ error: 'Semester ends before it starts' });
    return;
  }
  const key = (xs: Slot[]) => JSON.stringify(xs.map((s) => [s.weekday, s.start, s.end, s.place]));
  const changed = key(slotsOf(course)) !== key(slots);
  course.set('schedule', slots);
  course.set('semesterStart', start);
  course.set('semesterEnd', end);
  await course.save();
  if (changed && course.schedule.length + slots.length > 0) {
    notifyCourseStudents(course, {
      title: `מערכת השעות עודכנה · ${course.name}`,
      body: 'זמני השיעורים בקורס השתנו. פתחו את האפליקציה כדי לראות.',
      url: '/courses',
      tag: `schedule-${course.id}`,
    });
  }
  res.json({ schedule: slotsOf(course), semesterStart: course.semesterStart ?? null, semesterEnd: course.semesterEnd ?? null });
});

const isUpcoming = (date: string) => date >= localNow(new Date(), config.timeZone).date;

function announce(course: { id: string; name: string; roster: { email: string }[] }, e: { kind: string; date: string; start?: string | null; title?: string }, change: 'new' | 'updated' | 'removed') {
  if (!isUpcoming(e.date)) return;
  const what = describeEvent(e);
  const title =
    e.kind === 'cancelled'
      ? change === 'removed'
        ? `השיעור מתקיים כרגיל · ${course.name}`
        : `שיעור בוטל · ${course.name}`
      : change === 'new'
        ? `חדש בלוח הזמנים · ${course.name}`
        : change === 'updated'
          ? `שינוי בלוח הזמנים · ${course.name}`
          : `בוטל · ${course.name}`;
  notifyCourseStudents(course, { title, body: what, url: '/courses', tag: `event-${course.id}-${e.date}` });
}

scheduleRouter.post('/courses/:id/events', requireAuth, requireRole('lecturer'), async (req, res) => {
  const course = await findOwnCourse(String(req.params.id), req.auth!.sub);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const input = readEvent(req.body, slotsOf(course));
  if ('error' in input) {
    res.status(400).json(input);
    return;
  }
  if (input.kind === 'cancelled' && (await CourseEvent.exists({ courseId: course._id, kind: 'cancelled', slotId: input.slotId, date: input.date }))) {
    res.status(409).json({ error: 'That class is already cancelled' });
    return;
  }
  const e = await CourseEvent.create({ courseId: course._id, ...input });
  announce(course, e, 'new');
  res.status(201).json({ event: eventView(e) });
});

async function findOwnEvent(eventId: string, lecturerId: string) {
  if (!mongoose.isValidObjectId(eventId)) return null;
  const event = await CourseEvent.findById(eventId);
  if (!event) return null;
  const course = await findOwnCourse(String(event.courseId), lecturerId);
  return course ? { event, course } : null;
}

scheduleRouter.put('/events/:eventId', requireAuth, requireRole('lecturer'), async (req, res) => {
  const found = await findOwnEvent(String(req.params.eventId), req.auth!.sub);
  if (!found) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }
  const input = readEvent(req.body, slotsOf(found.course));
  if ('error' in input) {
    res.status(400).json(input);
    return;
  }
  found.event.set({ start: undefined, end: undefined, slotId: undefined, ...input });
  await found.event.save();
  announce(found.course, found.event, 'updated');
  res.json({ event: eventView(found.event) });
});

scheduleRouter.delete('/events/:eventId', requireAuth, requireRole('lecturer'), async (req, res) => {
  const found = await findOwnEvent(String(req.params.eventId), req.auth!.sub);
  if (!found) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }
  await found.event.deleteOne();
  announce(found.course, found.event, 'removed');
  res.json({ ok: true });
});
