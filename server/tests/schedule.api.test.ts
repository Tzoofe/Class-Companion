import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { setPushSender, settlePushes, type PushSender } from '../src/lib/push';
import { addDays, localNow, weekdayOf } from '../src/lib/time';
import { Course } from '../src/models/Course';
import { api, createLecturer, csv, loginToken, upload, useTestDb } from './helpers';

useTestDb();
afterEach(() => setPushSender(null));

type Auth = Record<string, string>;
const today = () => localNow(new Date(), config.timeZone).date;

async function setup() {
  const lecturer = await createLecturer();
  const course = await Course.create({
    name: 'מבוא',
    lecturerId: lecturer._id,
    roster: [
      { email: 'dana@uni.ac.il', firstName: 'דנה', lastName: 'כהן' },
      { email: 'ron@uni.ac.il', firstName: 'רון', lastName: 'לוי' },
    ],
  });
  const lect: Auth = { Authorization: `Bearer ${await loginToken('lect@uni.ac.il')}` };
  const dana: Auth = { Authorization: `Bearer ${(await api().post('/api/auth/signup').send({ email: 'dana@uni.ac.il', password: 'secret123' })).body.token}` };
  return { course, lect, dana };
}

function recordPushes() {
  const sent: string[] = [];
  const sender: PushSender = async (t, payload) => void sent.push(JSON.parse(payload).title);
  setPushSender(sender);
  return sent;
}

async function subscribe(auth: Auth) {
  await api().post('/api/push/subscribe').set(auth).send({ endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'k', auth: 'a' } });
}

describe('course settings & roster', () => {
  it('renames, changes radius and validates', async () => {
    const { course, lect, dana } = await setup();
    const res = await api().patch(`/api/courses/${course.id}`).set(lect).send({ name: ' מבוא 2 ', defaultRadiusM: 30 });
    expect(res.body.course).toMatchObject({ name: 'מבוא 2', defaultRadiusM: 30 });
    expect(res.body.course.roster.map((r: { email: string; registered: boolean }) => [r.email, r.registered])).toEqual([
      ['dana@uni.ac.il', true],
      ['ron@uni.ac.il', false],
    ]);
    expect((await api().patch(`/api/courses/${course.id}`).set(lect).send({ name: '' })).status).toBe(400);
    expect((await api().patch(`/api/courses/${course.id}`).set(lect).send({ defaultRadiusM: 1 })).status).toBe(400);
    expect((await api().patch(`/api/courses/${course.id}`).set(dana).send({ name: 'x' })).status).toBe(403);
  });

  it('adds and removes single students; the course appears for a newly added student', async () => {
    const { course, lect } = await setup();
    const add = (body: object) => api().post(`/api/courses/${course.id}/roster`).set(lect).send(body);
    expect((await add({ email: 'New@Uni.ac.il', firstName: 'נועה' })).status).toBe(201);
    expect((await add({ email: 'new@uni.ac.il' })).status).toBe(409);
    expect((await add({ email: 'nope' })).status).toBe(400);
    const noa = { Authorization: `Bearer ${(await api().post('/api/auth/signup').send({ email: 'new@uni.ac.il', password: 'secret123' })).body.token}` };
    expect((await api().get('/api/courses').set(noa)).body.courses).toHaveLength(1);
    expect((await api().delete(`/api/courses/${course.id}/roster/new@uni.ac.il`).set(lect)).body.course.roster).toHaveLength(2);
    expect((await api().get('/api/courses').set(noa)).body.courses).toHaveLength(0);
    expect((await api().delete(`/api/courses/${course.id}/roster/new@uni.ac.il`).set(lect)).status).toBe(404);
  });

  it('re-uploads a roster file: merge adds/updates, replace also removes', async () => {
    const { course, lect } = await setup();
    const file = csv([
      ['שם פרטי', 'שם משפחה', 'דוא״ל'],
      ['דנה', 'כהן-לוי', 'dana@uni.ac.il'],
      ['אבי', 'אבן', 'avi@uni.ac.il'],
    ]);
    const merge = await api().put(`/api/courses/${course.id}/roster`).set(lect).send(upload(file, 'r.csv', { mode: 'merge' }));
    expect(merge.body).toMatchObject({ added: 1, updated: 1, removed: 0 });
    expect(merge.body.course.roster).toHaveLength(3);
    const replace = await api().put(`/api/courses/${course.id}/roster`).set(lect).send(upload(file, 'r.csv', { mode: 'replace' }));
    expect(replace.body).toMatchObject({ added: 0, removed: 1 });
    expect(replace.body.course.roster.map((r: { email: string }) => r.email).sort()).toEqual(['avi@uni.ac.il', 'dana@uni.ac.il']);
  });
});

describe('schedule & events', () => {
  it('saves weekly slots, notifies students of changes (not of no-op saves)', async () => {
    const sent = recordPushes();
    const { course, lect, dana } = await setup();
    await subscribe(dana);
    const put = (body: object) => api().put(`/api/courses/${course.id}/schedule`).set(lect).send(body);
    const res = await put({ schedule: [{ weekday: 0, start: '10:00', end: '12:00', place: '204' }], semesterStart: '2026-10-25', semesterEnd: '2027-01-30' });
    expect(res.status).toBe(200);
    const slots = res.body.schedule;
    await put({ schedule: slots, semesterStart: '2026-10-25', semesterEnd: '2027-01-30' });
    await settlePushes();
    expect(sent).toEqual(['מערכת השעות עודכנה · מבוא']);
    expect((await put({ schedule: slots, semesterStart: '2027-02-01', semesterEnd: '2027-01-01' })).body.error).toBe('Semester ends before it starts');
    const forStudent = await api().get(`/api/courses/${course.id}/schedule`).set(dana);
    expect(forStudent.body.schedule).toHaveLength(1);
  });

  it('events: create / update / delete with notifications for upcoming ones; lecturer-only', async () => {
    const sent = recordPushes();
    const { course, lect, dana } = await setup();
    await subscribe(dana);
    const date = addDays(today(), 2);
    const created = await api().post(`/api/courses/${course.id}/events`).set(lect).send({ kind: 'office', date, start: '14:00', title: 'שעות קבלה', link: 'https://zoom.us/j/1' });
    expect(created.status).toBe(201);
    const id = created.body.event.id;
    expect((await api().put(`/api/events/${id}`).set(lect).send({ kind: 'office', date, start: '15:00', title: 'שעות קבלה' })).body.event.start).toBe('15:00');
    expect((await api().delete(`/api/events/${id}`).set(lect)).status).toBe(200);
    // Past events don't notify.
    await api().post(`/api/courses/${course.id}/events`).set(lect).send({ kind: 'meeting', date: addDays(today(), -3), start: '10:00', title: 'ישן' });
    await settlePushes();
    expect(sent).toEqual(['חדש בלוח הזמנים · מבוא', 'שינוי בלוח הזמנים · מבוא', 'בוטל · מבוא']);
    expect((await api().post(`/api/courses/${course.id}/events`).set(dana).send({ kind: 'office', date, start: '14:00', title: 'x' })).status).toBe(403);
  });

  it('cancelling a class: once per date, notifies, and shows as cancelled in the agenda', async () => {
    const sent = recordPushes();
    const { course, lect, dana } = await setup();
    await subscribe(dana);
    const date = addDays(today(), 1);
    const slots = (await api().put(`/api/courses/${course.id}/schedule`).set(lect).send({ schedule: [{ weekday: weekdayOf(date), start: '10:00', end: '12:00' }] })).body.schedule;
    const cancel = () => api().post(`/api/courses/${course.id}/events`).set(lect).send({ kind: 'cancelled', date, slotId: slots[0].id });
    expect((await cancel()).status).toBe(201);
    expect((await cancel()).status).toBe(409);
    await settlePushes();
    expect(sent.at(-1)).toBe('שיעור בוטל · מבוא');

    const agenda = await api().get(`/api/me/agenda?from=${date}&days=1`).set(dana);
    expect(agenda.body.items).toEqual([expect.objectContaining({ courseName: 'מבוא', kind: 'class', start: '10:00', cancelled: true })]);
    expect(agenda.body.hasSchedule).toBe(true);
  });
});

describe('agenda', () => {
  it("students see only their courses' items; lecturers their own courses", async () => {
    const { course, lect, dana } = await setup();
    const other = await Course.create({ name: 'אחר', lecturerId: course.lecturerId, roster: [{ email: 'x@uni.ac.il' }], schedule: [{ id: 'z', weekday: 0, start: '08:00', end: '09:00' }] });
    await api().put(`/api/courses/${course.id}/schedule`).set(lect).send({ schedule: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '10:00', end: '11:00' })) });
    const mine = await api().get('/api/me/agenda?days=7').set(dana);
    expect(mine.body.items).toHaveLength(7);
    expect(mine.body.items.every((i: { courseId: string }) => i.courseId === course.id)).toBe(true);
    expect(mine.body.now.date).toBe(today());
    const lecturer = await api().get('/api/me/agenda?days=7').set(lect);
    expect(lecturer.body.items.filter((i: { courseId: string }) => i.courseId === other.id)).toHaveLength(1);
  });
});

describe('GET /api/me/overview', () => {
  it('summarises live sessions, polls, questions and per-course stats', async () => {
    const { course, lect, dana } = await setup();
    await api().post(`/api/courses/${course.id}/sessions`).set(lect).send({ lat: 32.1, lng: 34.8, accuracy: 10 });
    await api().post(`/api/courses/${course.id}/polls`).set(lect).send({ question: 'הבנתם?', type: 'yesno', open: true });
    await api().post(`/api/courses/${course.id}/posts`).set(dana).send({ kind: 'question', text: 'שאלה', clientId: 'a' });
    const res = await api().get('/api/me/overview').set(lect);
    expect(res.status).toBe(200);
    expect(res.body.live.sessions).toEqual([expect.objectContaining({ courseId: course.id, present: 0, rosterCount: 2 })]);
    expect(res.body.live.polls).toEqual([expect.objectContaining({ question: 'הבנתם?', responses: 0 })]);
    expect(res.body.totals).toMatchObject({ courses: 1, students: 2, openQuestions: 1 });
    expect(res.body.attention.questions[0]).toMatchObject({ text: 'שאלה', courseName: 'מבוא' });
    expect(res.body.courses[0]).toMatchObject({ id: course.id, openQuestions: 1, pollOpen: true, liveSession: true });
    expect((await api().get('/api/me/overview').set(dana)).status).toBe(403);
  });
});
