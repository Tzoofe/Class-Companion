import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { setPushSender, settlePushes, type PushSender } from '../src/lib/push';
import { Course } from '../src/models/Course';
import { Poll } from '../src/models/Poll';
import { api, createLecturer, loginToken, useTestDb } from './helpers';

useTestDb();
afterEach(() => setPushSender(null));

type Auth = Record<string, string>;
const HERE = { lat: 32.1, lng: 34.8, accuracy: 5 };

async function setup() {
  const lecturer = await createLecturer();
  const course = await Course.create({
    name: 'מבוא',
    lecturerId: lecturer._id,
    roster: [
      { email: 'dana@uni.ac.il', firstName: 'דנה', lastName: 'כהן' },
      { email: 'ron@uni.ac.il', firstName: 'רון', lastName: 'לוי' },
      { email: 'late@uni.ac.il', firstName: 'אורי', lastName: 'אלון' },
    ],
  });
  const signup = async (email: string): Promise<Auth> => ({
    Authorization: `Bearer ${(await api().post('/api/auth/signup').send({ email, password: 'secret123' })).body.token}`,
  });
  const dana = await signup('dana@uni.ac.il');
  const ron = await signup('ron@uni.ac.il');
  const lect: Auth = { Authorization: `Bearer ${await loginToken('lect@uni.ac.il')}` };
  const create = (body: object) => api().post(`/api/courses/${course.id}/polls`).set(lect).send(body);
  const list = async (auth: Auth) => (await api().get(`/api/courses/${course.id}/polls`).set(auth)).body.polls as Record<string, any>[];
  const answer = (auth: Auth, pollId: string, body: object) => api().put(`/api/polls/${pollId}/response`).set(auth).send(body);
  const act = (pollId: string, action: string, body: object = {}) => api().post(`/api/polls/${pollId}/${action}`).set(lect).send(body);
  return { course, dana, ron, lect, create, list, answer, act };
}

const QUIZ = { question: '2+2?', type: 'choice', options: ['3', '4'], correct: [1] };

describe('poll lifecycle', () => {
  it('draft → open → answers → close; students never see drafts', async () => {
    const { create, list, dana, ron, answer, act } = await setup();
    const draft = (await create(QUIZ)).body.poll;
    expect(draft).toMatchObject({ status: 'draft', correctOptionIds: ['o2'], eligible: 3, results: { responses: 0, counts: { o1: 0, o2: 0 } } });
    expect(await list(dana)).toEqual([]);
    expect((await answer(dana, draft.id, { optionIds: ['o2'] })).status).toBe(404);

    expect((await act(draft.id, 'open')).body.poll.status).toBe('open');
    expect((await answer(dana, draft.id, { optionIds: ['o2'] })).status).toBe(200);
    expect((await answer(ron, draft.id, { optionIds: ['o1'] })).status).toBe(200);
    expect((await answer(ron, draft.id, { optionIds: ['o2'] })).body.poll.myAnswer).toEqual({ optionIds: ['o2'] }); // changed answer

    const lectView = (await act(draft.id, 'close')).body.poll;
    expect(lectView).toMatchObject({ status: 'closed', results: { responses: 2, counts: { o1: 0, o2: 2 } } });
    expect((await answer(dana, draft.id, { optionIds: ['o1'] })).body.error).toBe('Poll is closed');
  });

  it('hides results and the correct answer from students until revealed', async () => {
    const { create, list, dana, answer, act } = await setup();
    const poll = (await create({ ...QUIZ, open: true })).body.poll;
    await answer(dana, poll.id, { optionIds: ['o1'] });
    let mine = (await list(dana))[0];
    expect(mine).toMatchObject({ canAnswer: true, results: null, correctOptionIds: [], myAnswer: { optionIds: ['o1'] } });
    await act(poll.id, 'reveal', { revealed: true });
    mine = (await list(dana))[0];
    expect(mine).toMatchObject({ results: { responses: 1, counts: { o1: 1, o2: 0 } }, correctOptionIds: ['o2'] });
  });

  it('opening a poll closes the previous one and notifies students', async () => {
    const sent: string[] = [];
    const sender: PushSender = async (t, payload) => void sent.push(`${t.endpoint}|${JSON.parse(payload).url}`);
    setPushSender(sender);
    const { create, dana, course } = await setup();
    await api().post('/api/push/subscribe').set(dana).send({ endpoint: 'https://web.push.apple.com/dana', keys: { p256dh: 'k', auth: 'a' } });
    const first = (await create({ ...QUIZ, open: true })).body.poll;
    const second = (await create({ question: 'הבנתם?', type: 'yesno', open: true })).body.poll;
    expect((await Poll.findById(first.id))!.status).toBe('closed');
    expect((await Poll.findById(second.id))!.status).toBe('open');
    await settlePushes();
    expect(sent).toEqual([`https://web.push.apple.com/dana|/courses/${course.id}/polls`, `https://web.push.apple.com/dana|/courses/${course.id}/polls`]);
    const active = await api().get(`/api/courses/${course.id}/polls/active`).set(dana);
    expect(active.body.poll).toMatchObject({ id: second.id, answered: false, canAnswer: true });
  });

  it('edits drafts only; duplicates and deletes', async () => {
    const { create, lect, act, list } = await setup();
    const poll = (await create(QUIZ)).body.poll;
    const edited = await api().put(`/api/polls/${poll.id}`).set(lect).send({ ...QUIZ, question: '3+3?', options: ['6', '7'], correct: [0] });
    expect(edited.body.poll).toMatchObject({ question: '3+3?', correctOptionIds: ['o1'] });
    await act(poll.id, 'open');
    expect((await api().put(`/api/polls/${poll.id}`).set(lect).send(QUIZ)).status).toBe(409);
    const copy = (await act(poll.id, 'duplicate')).body.poll;
    expect(copy).toMatchObject({ status: 'draft', question: '3+3?' });
    expect((await api().delete(`/api/polls/${poll.id}`).set(lect)).status).toBe(200);
    expect((await list(lect)).map((p) => p.id)).toEqual([copy.id]);
  });
});

describe('audience', () => {
  it('"present only" needs open attendance and accepts only students present', async () => {
    const { create, course, lect, dana, ron, answer, list } = await setup();
    expect((await create({ ...QUIZ, audience: 'present', open: true })).body.error).toBe('Attendance is not open');

    const sessionId = (await api().post(`/api/courses/${course.id}/sessions`).set(lect).send({ ...HERE, accuracy: 10 })).body.session.id;
    await api().post(`/api/sessions/${sessionId}/check-in`).set(dana).send({ ...HERE, timestamp: Date.now() });
    const poll = (await create({ ...QUIZ, audience: 'present', open: true })).body.poll;
    expect(poll.eligible).toBe(1);
    expect((await answer(dana, poll.id, { optionIds: ['o2'] })).status).toBe(200);
    const no = await answer(ron, poll.id, { optionIds: ['o2'] });
    expect(no.status).toBe(403);
    expect((await list(ron))[0]).toMatchObject({ canAnswer: false, eligible: false });

    // The lecturer marks Ron present → he can answer.
    await api().put(`/api/sessions/${sessionId}/attendance`).set(lect).send({ email: 'ron@uni.ac.il', present: true });
    expect((await answer(ron, poll.id, { optionIds: ['o2'] })).status).toBe(200);
  });

  it('only course members see polls; only students answer', async () => {
    const { create, course, lect, answer } = await setup();
    const poll = (await create({ ...QUIZ, open: true })).body.poll;
    const outsider = { Authorization: `Bearer ${(await api().post('/api/auth/signup').send({ email: 'x@uni.ac.il', password: 'secret123' })).body.token}` };
    expect((await api().get(`/api/courses/${course.id}/polls`).set(outsider)).status).toBe(404);
    expect((await answer(outsider, poll.id, { optionIds: ['o1'] })).status).toBe(404);
    expect((await answer(lect, poll.id, { optionIds: ['o1'] })).status).toBe(403);
  });
});

describe('scale and text polls', () => {
  it('aggregates and validates per type', async () => {
    const { create, dana, ron, answer, lect, course } = await setup();
    const scale = (await create({ question: 'כמה הבנתם?', type: 'scale', open: true })).body.poll;
    await answer(dana, scale.id, { value: 4 });
    expect((await answer(ron, scale.id, { value: 5 })).status).toBe(200);
    expect((await answer(ron, scale.id, { optionIds: ['o1'] })).status).toBe(400);
    const text = (await create({ question: 'מילה אחת על השיעור', type: 'text', open: true })).body.poll;
    await answer(dana, text.id, { text: 'מעולה' });
    const polls = (await api().get(`/api/courses/${course.id}/polls`).set(lect)).body.polls;
    expect(polls.find((p: { id: string }) => p.id === scale.id).results.scale).toEqual({ counts: [0, 0, 0, 1, 1], average: 4.5 });
    expect(polls.find((p: { id: string }) => p.id === text.id).results.texts).toEqual(['מעולה']);
  });
});

describe('dashboard and export', () => {
  it('reports the open poll and adds poll sheets with per-student answers', async () => {
    const { create, dana, answer, lect, course } = await setup();
    const poll = (await create({ ...QUIZ, open: true })).body.poll;
    await answer(dana, poll.id, { optionIds: ['o2'] });
    const dash = await api().get(`/api/courses/${course.id}/dashboard`).set(lect);
    expect(dash.body.polls).toEqual({ open: { id: poll.id, question: '2+2?' }, total: 1 });

    const res = await api()
      .get(`/api/courses/${course.id}/export`)
      .set(lect)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    expect((wb.getWorksheet('סקרים')!.getRow(5).values as unknown[]).slice(2)).toEqual(['2+2?', 'בחירה', 1, '3: 0\n4: 1 ✓']);
    expect((wb.getWorksheet('תשובות לסקרים')!.getRow(5).values as unknown[]).slice(1)).toEqual(['2+2?', 'כהן', 'דנה', 'dana@uni.ac.il', '4', 'כן']);
  });
});
