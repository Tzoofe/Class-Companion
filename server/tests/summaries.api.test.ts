import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setPushSender, settlePushes, type PushSender } from '../src/lib/push';
import { setSummaryEngines, settleSummaries } from '../src/lib/summaries/pipeline';
import { Course } from '../src/models/Course';
import { LessonSummary } from '../src/models/LessonSummary';
import { api, createLecturer, loginToken, useTestDb } from './helpers';

useTestDb();

let mediaDir = '';
beforeAll(() => {
  mediaDir = mkdtempSync(path.join(tmpdir(), 'cc-media-'));
  process.env.MEDIA_DIR = mediaDir;
});
afterAll(() => {
  delete process.env.MEDIA_DIR;
  delete process.env.MAX_UPLOAD_MB;
});
afterEach(() => {
  setSummaryEngines({ transcriber: null, llm: null });
  setPushSender(null);
});

const fakeLlm = async ({ user }: { user: string }) =>
  user.includes('תמלול:')
    ? { topics: [{ title: 'רקורסיה', points: ['פונקציה שקוראת לעצמה'] }], concepts: [{ term: 'מקרה בסיס', definition: 'תנאי עצירה' }], reminders: ['תרגיל 3 עד יום ראשון'] }
    : { overview: 'שיעור על רקורסיה.', confusion: user.includes('למה צריך') ? ['מקרה הבסיס'] : [], reviewQuestions: ['מהו מקרה בסיס?'] };

const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nהיום נדבר על רקורסיה\n\n00:00:05.000 --> 00:00:09.000\nשימו לב, זה במבחן\n';

async function setup() {
  setSummaryEngines({ transcriber: async () => [{ start: 0, end: 5, text: 'תמלול מהקלטה' }], llm: fakeLlm });
  const lecturer = await createLecturer();
  const course = await Course.create({ name: 'מבוא', lecturerId: lecturer._id, roster: [{ email: 'dana@uni.ac.il' }] });
  const lect = { Authorization: `Bearer ${await loginToken('lect@uni.ac.il')}` };
  const dana = { Authorization: `Bearer ${(await api().post('/api/auth/signup').send({ email: 'dana@uni.ac.il', password: 'secret123' })).body.token}` };
  const upload = (fileName: string, body: string | Buffer, query = '') =>
    api()
      .post(`/api/courses/${course.id}/summaries?fileName=${encodeURIComponent(fileName)}${query}`)
      .set(lect)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.isBuffer(body) ? body : Buffer.from(body));
  return { course, lect, dana, upload };
}

describe('lesson summaries', () => {
  it('summarizes an uploaded Zoom transcript into a draft only the lecturer sees', async () => {
    const { course, lect, dana, upload } = await setup();
    const res = await upload('zoom.vtt', VTT, '&date=2026-11-24&title=' + encodeURIComponent('שיעור 5'));
    expect(res.status).toBe(201);
    expect(res.body.summary).toMatchObject({ status: 'queued', date: '2026-11-24', title: 'שיעור 5' });
    await settleSummaries();

    const one = await api().get(`/api/summaries/${res.body.summary.id}`).set(lect);
    expect(one.body.summary).toMatchObject({ status: 'draft', progress: 100, content: { overview: 'שיעור על רקורסיה.', reminders: ['תרגיל 3 עד יום ראשון'] } });
    expect(one.body.summary.content.topics[0]).toMatchObject({ at: 1, title: 'רקורסיה' });
    expect(one.body.transcript).toHaveLength(2);

    expect((await api().get(`/api/courses/${course.id}/summaries`).set(dana)).body.summaries).toEqual([]);
    expect((await api().get(`/api/summaries/${res.body.summary.id}`).set(dana)).status).toBe(404);
  });

  it('transcribes a recording, deletes the file afterwards, and links the lesson session by date', async () => {
    const { course, lect, upload } = await setup();
    const session = (await api().post(`/api/courses/${course.id}/sessions`).set(lect).send({ lat: 32.1, lng: 34.8, accuracy: 10 })).body.session;
    await api().post(`/api/sessions/${session.id}/close`).set(lect);
    const res = await upload('lesson.m4a', Buffer.alloc(2048, 1));
    expect(res.body.summary.sessionId).toBe(session.id);
    await settleSummaries();
    const doc = await LessonSummary.findById(res.body.summary.id);
    expect(doc).toMatchObject({ status: 'draft' });
    expect(doc!.transcript[0].text).toBe('תמלול מהקלטה');
    expect(doc!.mediaPath).toBeUndefined();
    expect(readdirSync(mediaDir)).toEqual([]);
  });

  it('uses the questions asked in that lesson for "where students struggled"', async () => {
    const { course, lect, dana, upload } = await setup();
    const session = (await api().post(`/api/courses/${course.id}/sessions`).set(lect).send({ lat: 32.1, lng: 34.8, accuracy: 10 })).body.session;
    await api().post(`/api/courses/${course.id}/posts`).set(dana).send({ kind: 'question', text: 'למה צריך מקרה בסיס?', clientId: 'q' });
    const res = await upload('zoom.vtt', VTT, `&sessionId=${session.id}`);
    await settleSummaries();
    expect((await LessonSummary.findById(res.body.summary.id))!.content!.confusion).toEqual(['מקרה הבסיס']);
  });

  it('records a failure with its reason and can retry', async () => {
    const { lect, upload } = await setup();
    setSummaryEngines({ transcriber: async () => [{ start: 0, end: 1, text: 'x' }], llm: async () => { throw new Error('Local model error (500): out of memory'); } });
    const res = await upload('zoom.vtt', VTT);
    await settleSummaries();
    const failed = (await api().get(`/api/summaries/${res.body.summary.id}`).set(lect)).body.summary;
    expect(failed).toMatchObject({ status: 'failed', error: 'Local model error (500): out of memory' });

    setSummaryEngines({ llm: fakeLlm });
    expect((await api().post(`/api/summaries/${res.body.summary.id}/retry`).set(lect)).body.summary.status).toBe('queued');
    await settleSummaries();
    expect((await LessonSummary.findById(res.body.summary.id))!.status).toBe('draft');
  });

  it('lets the lecturer edit and publish; students then see it and get a notification', async () => {
    const sent: string[] = [];
    const sender: PushSender = async (_t, payload) => void sent.push(JSON.parse(payload).url);
    setPushSender(sender);
    const { course, lect, dana, upload } = await setup();
    await api().post('/api/push/subscribe').set(dana).send({ endpoint: 'https://web.push.apple.com/d', keys: { p256dh: 'k', auth: 'a' } });
    const id = (await upload('zoom.vtt', VTT)).body.summary.id;
    await settleSummaries();

    const edited = await api().put(`/api/summaries/${id}`).set(lect).send({ title: 'רקורסיה', content: { overview: 'מתוקן', reviewQuestions: ['א', '', 'ב'] } });
    expect(edited.body.summary).toMatchObject({ title: 'רקורסיה', content: { overview: 'מתוקן', reviewQuestions: ['א', 'ב'] } });
    expect((await api().put(`/api/summaries/${id}`).set(dana).send({ title: 'x' })).status).toBe(403);

    expect((await api().post(`/api/summaries/${id}/publish`).set(lect).send({ published: true })).body.summary.status).toBe('published');
    await settlePushes();
    expect(sent).toEqual([`/courses/${course.id}/summaries/${id}`]);
    const forStudent = await api().get(`/api/summaries/${id}`).set(dana);
    expect(forStudent.body.summary).toMatchObject({ title: 'רקורסיה', sourceName: '' });
    expect(forStudent.body.transcript).toBeUndefined();

    expect((await api().post(`/api/summaries/${id}/publish`).set(lect).send({ published: false })).body.summary.status).toBe('draft');
    expect((await api().get(`/api/courses/${course.id}/summaries`).set(dana)).body.summaries).toEqual([]);
  });

  it('rejects unsupported, empty and oversized files; deletes summaries', async () => {
    const { lect, upload } = await setup();
    expect((await upload('notes.pdf', 'x')).status).toBe(400);
    expect((await upload('empty.vtt', 'WEBVTT\n')).body.error).toBe('The transcript is empty');
    process.env.MAX_UPLOAD_MB = '0.001';
    expect((await upload('big.mp4', Buffer.alloc(4096))).status).toBe(413);
    delete process.env.MAX_UPLOAD_MB;
    expect(readdirSync(mediaDir).filter((f) => f.endsWith('.mp4'))).toEqual([]);

    const id = (await upload('zoom.vtt', VTT)).body.summary.id;
    await settleSummaries();
    expect((await api().delete(`/api/summaries/${id}`).set(lect)).status).toBe(200);
    expect(await LessonSummary.countDocuments()).toBe(0);
    expect(existsSync(mediaDir)).toBe(true);
  });
});
