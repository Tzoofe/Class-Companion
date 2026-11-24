import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { settleJobs } from '../src/lib/jobs';
import { setPushSender, settlePushes, type PushSender } from '../src/lib/push';
import type { LlmClient } from '../src/lib/summaries/llm';
import { Assignment, Submission } from '../src/models/Assignment';
import { Course } from '../src/models/Course';
import { setReviewLlm } from '../src/routes/assignments';
import { makePdf, makeZip } from './fixtures';
import { api, createLecturer, loginToken, useTestDb } from './helpers';

useTestDb();

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cc-subs-'));
  process.env.SUBMISSIONS_DIR = dir;
});
afterAll(() => delete process.env.SUBMISSIONS_DIR);
afterEach(() => {
  setReviewLlm(null);
  setPushSender(null);
});

const models: string[] = [];
/** Fake reviewer: meets "base" only when the text mentions "base case". */
const fakeLlm: LlmClient = async ({ user, model }) => {
  models.push(model ?? 'default');
  if (user.includes('commonIssues')) return { summary: 'רוב הכיתה בסדר', commonIssues: ['חסר ניתוח סיבוכיות'], strengths: ['קוד קריא'] };
  const base = /base case|fact\(n - 1\)/i.test(user);
  return {
    summary: base ? 'פתרון טוב' : 'חסר מקרה בסיס',
    strengths: ['מסודר'],
    improvements: base ? ['להוסיף ניתוח סיבוכיות'] : ['להוסיף מקרה בסיס'],
    criteria: [
      { criterionId: 'base', met: base ? 'yes' : 'no', feedback: 'נבדק', suggestion: 'שפר', points: base ? 60 : 10 },
      { criterionId: 'complexity', met: 'partial', feedback: 'חלקי', suggestion: 'נתח', points: 20 },
    ],
  };
};

const CRITERIA = [
  { id: 'base', title: 'מקרה בסיס', points: 60 },
  { id: 'complexity', title: 'סיבוכיות', points: 40 },
];

async function setup(studentCount = 2) {
  setReviewLlm(fakeLlm);
  const lecturer = await createLecturer();
  const emails = Array.from({ length: studentCount }, (_, i) => `s${i}@uni.ac.il`);
  const course = await Course.create({ name: 'מבוא', lecturerId: lecturer._id, roster: emails.map((email, i) => ({ email, firstName: `סטודנט${i}`, lastName: 'כהן' })) });
  const lect = { Authorization: `Bearer ${await loginToken('lect@uni.ac.il')}` };
  const students = await Promise.all(emails.map(async (email) => ({ Authorization: `Bearer ${(await api().post('/api/auth/signup').send({ email, password: 'secret123' })).body.token}` })));
  const create = (body: object) => api().post(`/api/courses/${course.id}/assignments`).set(lect).send({ title: 'רקורסיה', instructions: 'כתבו עצרת', criteria: CRITERIA, ...body });
  const submit = (auth: Record<string, string>, aid: string, kind: 'final' | 'practice', fileName: string, body: Buffer) =>
    api().post(`/api/assignments/${aid}/submissions?kind=${kind}&fileName=${encodeURIComponent(fileName)}`).set(auth).set('Content-Type', 'application/octet-stream').send(body);
  return { course, lect, students, create, submit };
}

const future = () => new Date(Date.now() + 864e5).toISOString();
const GOOD = makePdf('The base case is n equals 0 and fact(n) = n * fact(n - 1)');

describe('assignments', () => {
  it('creates, publishes (notifying students) and hides drafts from students', async () => {
    const sent: string[] = [];
    const sender: PushSender = async (_t, p) => void sent.push(JSON.parse(p).title);
    setPushSender(sender);
    const { course, students, create } = await setup(1);
    await api().post('/api/push/subscribe').set(students[0]).send({ endpoint: 'https://web.push.apple.com/s0', keys: { p256dh: 'k', auth: 'a' } });
    const draft = (await create({ dueAt: future() })).body.assignment;
    expect(draft).toMatchObject({ status: 'draft', maxPoints: 100, criteria: [{ id: 'base' }, { id: 'complexity' }] });
    expect((await api().get(`/api/courses/${course.id}/assignments`).set(students[0])).body.assignments).toEqual([]);
    const pub = (await create({ dueAt: future(), publish: true })).body.assignment;
    expect(pub.status).toBe('published');
    await settlePushes();
    expect(sent).toEqual(['מטלה חדשה · מבוא']);
    expect((await create({ dueAt: 'nope' })).body.error).toBe('Invalid due date');
    expect((await create({ dueAt: future(), criteria: [{ title: '' }] })).body.error).toBe('Invalid criteria');
  });

  it('final submission → AI review the student sees without points; late marked; resubmit replaces', async () => {
    const { students, create, submit, lect } = await setup(1);
    const a = (await create({ dueAt: new Date(Date.now() - 3600_000).toISOString(), publish: true })).body.assignment; // due an hour ago
    const res = await submit(students[0], a.id, 'final', 'hw.pdf', GOOD);
    expect(res.status).toBe(201);
    expect(res.body.submission.lateMs).toBeGreaterThan(3_500_000);
    await settleJobs();

    const mine = (await api().get(`/api/assignments/${a.id}`).set(students[0])).body;
    expect(mine.final.review).toMatchObject({ status: 'done', summary: 'פתרון טוב' });
    expect(mine.final.review.criteria[0]).not.toHaveProperty('points');
    expect(mine.final.grade).toBeNull();

    const forLecturer = (await api().get(`/api/assignments/${a.id}`).set(lect)).body;
    expect(forLecturer.submissions).toHaveLength(1);
    expect(forLecturer.submissions[0]).toMatchObject({ name: 'סטודנט0 כהן', suggestedPoints: 80 });
    expect(forLecturer.submissions[0].review.criteria[0].points).toBe(60);
    expect(forLecturer.missing).toEqual([]);

    await submit(students[0], a.id, 'final', 'hw2.pdf', makePdf('version two without the important part'));
    expect(await Submission.countDocuments({ kind: 'final' })).toBe(1);
    await settleJobs();
    expect((await Submission.findOne({ kind: 'final' }))!.review!.summary).toBe('חסר מקרה בסיס');
    expect(readdirSync(dir)).toHaveLength(1); // old file removed
  });

  it('practice reviews are private to the student and limited', async () => {
    const { students, create, submit, lect } = await setup(1);
    const a = (await create({ dueAt: future(), publish: true, practiceLimit: 2 })).body.assignment;
    expect((await submit(students[0], a.id, 'practice', 'd1.pdf', GOOD)).status).toBe(201);
    expect((await submit(students[0], a.id, 'practice', 'd2.pdf', GOOD)).status).toBe(201);
    const third = await submit(students[0], a.id, 'practice', 'd3.pdf', GOOD);
    expect(third.status).toBe(409);
    expect(third.body.error).toBe('No practice reviews left');
    await settleJobs();
    const mine = (await api().get(`/api/assignments/${a.id}`).set(students[0])).body;
    expect(mine).toMatchObject({ practiceLeft: 0, final: null });
    expect(mine.practice).toHaveLength(2);
    expect(mine.practice[0].review.status).toBe('done');
    const lecturerView = (await api().get(`/api/assignments/${a.id}`).set(lect)).body;
    expect(lecturerView.submissions).toEqual([]); // drafts aren't submissions
  });

  it('routes code ZIPs to the code model and PDFs to the general model (both Aya by default)', async () => {
    const { students, create, submit } = await setup(2);
    const a = (await create({ dueAt: future(), publish: true })).body.assignment;
    models.length = 0;
    await submit(students[0], a.id, 'final', 'code.zip', makeZip({ 'fact.py': 'def fact(n):\n  return 1 if n == 0 else n * fact(n - 1)\n' }));
    await submit(students[1], a.id, 'final', 'hw.pdf', GOOD);
    await settleJobs();
    expect(models).toEqual([config.ollama.codeModel, config.ollama.model]);
    expect(config.ollama.codeModel).toBe('aya-expanse:8b');
  });

  it('rejects bad uploads with a reason', async () => {
    const { students, create, submit } = await setup(1);
    const a = (await create({ dueAt: future(), publish: true })).body.assignment;
    expect((await submit(students[0], a.id, 'final', 'hw.docx', Buffer.from('x'))).body.error).toBe('Upload a PDF or ZIP file');
    expect((await submit(students[0], a.id, 'final', 'scan.pdf', makePdf(''))).body.error).toBe('No readable text in the PDF (is it scanned?)');
    expect((await submit(students[0], a.id, 'final', 'empty.pdf', Buffer.alloc(0))).body.error).toBe('The file is empty');
  });

  it('grades, releases grades (notifying graded students), and students see them only after release', async () => {
    const sent: string[] = [];
    const sender: PushSender = async (_t, p) => void sent.push(JSON.parse(p).title);
    const { students, create, submit, lect } = await setup(1);
    const a = (await create({ dueAt: future(), publish: true })).body.assignment;
    const sid = (await submit(students[0], a.id, 'final', 'hw.pdf', GOOD)).body.submission.id;
    await settleJobs();
    const graded = await api().put(`/api/submissions/${sid}/grade`).set(lect).send({ criteria: [{ criterionId: 'base', points: 99 }, { criterionId: 'complexity', points: 30 }], comment: 'יפה' });
    expect(graded.body.submission.grade).toMatchObject({ points: 90, comment: 'יפה' }); // 60 (clamped) + 30
    expect((await api().get(`/api/assignments/${a.id}`).set(students[0])).body.final.grade).toBeNull();

    setPushSender(sender);
    await api().post('/api/push/subscribe').set(students[0]).send({ endpoint: 'https://web.push.apple.com/s0', keys: { p256dh: 'k', auth: 'a' } });
    await api().post(`/api/assignments/${a.id}/release`).set(lect).send({ released: true });
    await settlePushes();
    expect(sent).toEqual(['הציון פורסם · מבוא']);
    expect((await api().get(`/api/assignments/${a.id}`).set(students[0])).body.final.grade).toMatchObject({ points: 90, comment: 'יפה' });
    expect((await api().put(`/api/submissions/${sid}/grade`).set(students[0]).send({ points: 100 })).status).toBe(403);
    expect((await api().put(`/api/submissions/${sid}/grade`).set(lect).send({ points: 500 })).status).toBe(400);
  });

  it('compares a student to the class only with enough reviewed classmates', async () => {
    const { students, create, submit } = await setup(6);
    const a = (await create({ dueAt: future(), publish: true })).body.assignment;
    // 4 classmates meet "base", 1 doesn't
    for (let i = 1; i <= 4; i++) await submit(students[i], a.id, 'final', 'hw.pdf', GOOD);
    await submit(students[5], a.id, 'final', 'hw.pdf', makePdf('nothing relevant here at all, sorry'));
    await settleJobs();
    expect((await api().get(`/api/assignments/${a.id}`).set(students[0])).body.classShares).toEqual({ base: 80, complexity: 0 });
    await Submission.deleteMany({ email: 's5@uni.ac.il' });
    expect((await api().get(`/api/assignments/${a.id}`).set(students[0])).body.classShares).toBeNull();
  });

  it('flags similar submissions and builds a class overview for the lecturer', async () => {
    const { students, create, submit, lect } = await setup(3);
    const a = (await create({ dueAt: future(), publish: true })).body.assignment;
    const code = 'def fact(n):\n  if n == 0:\n    return 1\n  return n * fact(n - 1)\n# recursive factorial with a base case of zero and a recursive step';
    await submit(students[0], a.id, 'final', 'a.zip', makeZip({ 'a/fact.py': code }));
    await submit(students[1], a.id, 'final', 'b.zip', makeZip({ 'b/renamed.py': code.toUpperCase() }));
    await submit(students[2], a.id, 'final', 'c.pdf', makePdf('A completely different essay about iterative loops and stacks'));
    await settleJobs();
    const sim = (await api().get(`/api/assignments/${a.id}/similarity`).set(lect)).body.pairs;
    expect(sim).toHaveLength(1);
    expect(sim[0]).toMatchObject({ a: { name: 'סטודנט0 כהן' }, b: { name: 'סטודנט1 כהן' }, score: 1 });
    expect((await api().get(`/api/assignments/${a.id}/similarity`).set(students[0])).status).toBe(403);

    expect((await api().post(`/api/assignments/${a.id}/overview`).set(lect)).status).toBe(202);
    await settleJobs();
    expect((await Assignment.findById(a.id))!.classOverview).toMatchObject({ commonIssues: ['חסר ניתוח סיבוכיות'], basedOn: 3 });
  });

  it('lets students download only their own file; lecturers any', async () => {
    const { students, create, submit, lect } = await setup(2);
    const a = (await create({ dueAt: future(), publish: true })).body.assignment;
    const sid = (await submit(students[0], a.id, 'final', 'hw.pdf', GOOD)).body.submission.id;
    await settleJobs();
    expect((await api().get(`/api/submissions/${sid}/file`).set(lect)).status).toBe(200);
    expect((await api().get(`/api/submissions/${sid}/file`).set(students[0])).status).toBe(200);
    expect((await api().get(`/api/submissions/${sid}/file`).set(students[1])).status).toBe(404);
  });
});
