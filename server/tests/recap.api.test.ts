import { describe, expect, it } from 'vitest';
import { pollHeadline } from '../src/lib/recap';
import { Course } from '../src/models/Course';
import { Session } from '../src/models/Session';
import { api, createLecturer, loginToken, useTestDb } from './helpers';

useTestDb();

const HERE = { lat: 32.1, lng: 34.8, accuracy: 5 };

describe('pollHeadline', () => {
  it('names the leading option, the scale average, or the text count', () => {
    const opts = [{ id: 'o1', text: 'כן' }, { id: 'o2', text: 'לא' }];
    expect(pollHeadline({ type: 'yesno', options: opts }, { responses: 4, counts: { o1: 3, o2: 1 } })).toEqual({ text: 'כן', percent: 75 });
    expect(pollHeadline({ type: 'scale', options: [] }, { responses: 2, scale: { counts: [0, 0, 0, 1, 1], average: 4.5 } })).toEqual({ text: 'ממוצע 4.5', percent: null });
    expect(pollHeadline({ type: 'yesno', options: opts }, { responses: 0, counts: { o1: 0, o2: 0 } })).toBeNull();
  });
});

describe('overview recap', () => {
  it("summarises today's last lesson once it's closed, and not while it's live", async () => {
    const lecturer = await createLecturer();
    const course = await Course.create({
      name: 'מבוא',
      lecturerId: lecturer._id,
      roster: [{ email: 'dana@uni.ac.il' }, { email: 'ron@uni.ac.il' }, { email: 'noa@uni.ac.il' }],
    });
    const lect = { Authorization: `Bearer ${await loginToken('lect@uni.ac.il')}` };
    const dana = { Authorization: `Bearer ${(await api().post('/api/auth/signup').send({ email: 'dana@uni.ac.il', password: 'secret123' })).body.token}` };
    const overview = async () => (await api().get('/api/me/overview').set(lect)).body;

    expect((await overview()).recap).toBeNull(); // nothing yet

    const sessionId = (await api().post(`/api/courses/${course.id}/sessions`).set(lect).send({ ...HERE, accuracy: 10 })).body.session.id;
    await api().post(`/api/sessions/${sessionId}/check-in`).set(dana).send({ ...HERE, timestamp: Date.now() });
    await api().put(`/api/sessions/${sessionId}/attendance`).set(lect).send({ email: 'ron@uni.ac.il', present: true });
    await api().post(`/api/courses/${course.id}/posts`).set(dana).send({ kind: 'question', text: 'מה זה?', clientId: 'q1' });
    await api().post(`/api/courses/${course.id}/posts`).set(dana).send({ kind: 'suggestion', text: 'עוד דוגמאות', clientId: 's1' });
    const poll = (await api().post(`/api/courses/${course.id}/polls`).set(lect).send({ question: 'הבנתם?', type: 'yesno', open: true })).body.poll;
    await api().put(`/api/polls/${poll.id}/response`).set(dana).send({ optionIds: ['yes'] });

    expect((await overview()).recap).toBeNull(); // still live

    await api().post(`/api/sessions/${sessionId}/close`).set(lect);
    expect((await overview()).recap).toMatchObject({
      courseName: 'מבוא',
      sessionId,
      rosterCount: 3,
      present: 2,
      manual: 1,
      questions: 1,
      unanswered: 1,
      suggestions: 1,
      polls: [{ question: 'הבנתם?', responses: 1, top: { text: 'כן', percent: 100 } }],
    });
  });

  it('ignores sessions that ended on an earlier day', async () => {
    const lecturer = await createLecturer();
    const course = await Course.create({ name: 'ישן', lecturerId: lecturer._id, roster: [] });
    const twoDaysAgo = new Date(Date.now() - 2 * 864e5);
    await Session.create({ courseId: course._id, center: { type: 'Point', coordinates: [34.8, 32.1] }, centerAccuracyM: 10, radiusM: 20, startsAt: twoDaysAgo, endsAt: twoDaysAgo, status: 'closed' });
    const lect = { Authorization: `Bearer ${await loginToken('lect@uni.ac.il')}` };
    expect((await api().get('/api/me/overview').set(lect)).body.recap).toBeNull();
  });
});
