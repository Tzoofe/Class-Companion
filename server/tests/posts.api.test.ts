import { afterEach, describe, expect, it } from 'vitest';
import { setPushSender, settlePushes, type PushSender } from '../src/lib/push';
import { Course } from '../src/models/Course';
import { Post } from '../src/models/Post';
import { POST_RATE_LIMIT } from '../src/routes/posts';
import { api, createLecturer, loginToken, useTestDb } from './helpers';

useTestDb();
afterEach(() => setPushSender(null));

type Auth = Record<string, string>;
let n = 0;
const cid = () => `c-${++n}`;

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
  const signup = async (email: string): Promise<Auth> => ({
    Authorization: `Bearer ${(await api().post('/api/auth/signup').send({ email, password: 'secret123' })).body.token}`,
  });
  const dana = await signup('dana@uni.ac.il');
  const ron = await signup('ron@uni.ac.il');
  const outsider = await signup('out@uni.ac.il');
  const lect: Auth = { Authorization: `Bearer ${await loginToken('lect@uni.ac.il')}` };
  const post = (auth: Auth, body: Record<string, unknown> = {}) =>
    api().post(`/api/courses/${course.id}/posts`).set(auth).send({ kind: 'question', text: 'מה זה רקורסיה?', clientId: cid(), ...body });
  const feed = async (auth: Auth) => (await api().get(`/api/courses/${course.id}/posts`).set(auth)).body.posts as Record<string, unknown>[];
  return { course, dana, ron, outsider, lect, post, feed };
}

describe('posting', () => {
  it('saves a question with the roster name; only course members can post or read', async () => {
    const { post, feed, dana, outsider, course } = await setup();
    const res = await post(dana);
    expect(res.status).toBe(201);
    expect(res.body.post).toMatchObject({ kind: 'question', author: 'דנה כהן', mine: true, votes: 0, status: 'open', duringClass: false });
    expect(await feed(dana)).toHaveLength(1);
    expect((await post(outsider)).status).toBe(404);
    expect((await api().get(`/api/courses/${course.id}/posts`).set(outsider)).status).toBe(404);
  });

  it('is idempotent per clientId (offline retries)', async () => {
    const { post, dana } = await setup();
    const first = await post(dana, { clientId: 'same' });
    const again = await post(dana, { clientId: 'same' });
    expect(again.status).toBe(200);
    expect(again.body.post.id).toBe(first.body.post.id);
    expect(await Post.countDocuments()).toBe(1);
  });

  it('validates input and the lecturer cannot post', async () => {
    const { post, dana, lect } = await setup();
    expect((await post(dana, { kind: 'rant' })).status).toBe(400);
    expect((await post(dana, { text: '   ' })).body.error).toBe('Post text is required');
    expect((await post(dana, { text: 'x'.repeat(501) })).body.error).toBe('Post is too long');
    expect((await post(dana, { clientId: undefined })).status).toBe(400);
    expect((await post(lect)).status).toBe(403);
  });

  it(`limits a student to ${POST_RATE_LIMIT} posts a minute`, async () => {
    const { post, dana } = await setup();
    for (let i = 0; i < POST_RATE_LIMIT; i++) expect((await post(dana)).status).toBe(201);
    expect((await post(dana)).status).toBe(429);
  });

  it('tags posts made while attendance is open', async () => {
    const { post, dana, lect, course } = await setup();
    await api().post(`/api/courses/${course.id}/sessions`).set(lect).send({ lat: 32.1, lng: 34.8, accuracy: 10 });
    expect((await post(dana)).body.post.duringClass).toBe(true);
  });
});

describe('anonymous posts', () => {
  it('hide the author from other students only', async () => {
    const { post, feed, dana, ron, lect } = await setup();
    await post(dana, { anonymous: true });
    const forRon = (await feed(ron))[0];
    expect(forRon).toMatchObject({ author: null, anonymous: true, mine: false });
    expect(JSON.stringify(forRon)).not.toContain('דנה');
    expect((await feed(dana))[0]).toMatchObject({ author: 'דנה כהן', anonymous: true, mine: true });
    expect((await feed(lect))[0]).toMatchObject({ author: 'דנה כהן', anonymous: true });
  });
});

describe('votes', () => {
  it('one per student, not on your own post, and can be undone', async () => {
    const { post, dana, ron } = await setup();
    const id = (await post(dana)).body.post.id;
    const vote = (auth: Auth, up: boolean) => api().post(`/api/posts/${id}/vote`).set(auth).send({ up });
    expect((await vote(ron, true)).body.post).toMatchObject({ votes: 1, votedByMe: true });
    expect((await vote(ron, true)).body.post.votes).toBe(1);
    expect((await vote(dana, true)).status).toBe(400);
    expect((await vote(ron, false)).body.post).toMatchObject({ votes: 0, votedByMe: false });
  });
});

describe('lecturer moderation', () => {
  it('pins, answers with a reply (notifying the author) and hides', async () => {
    const sent: string[] = [];
    const sender: PushSender = async (t, payload) => void sent.push(`${t.endpoint}|${JSON.parse(payload).title}`);
    setPushSender(sender);
    const { post, feed, dana, ron, lect } = await setup();
    await api().post('/api/push/subscribe').set(dana).send({ endpoint: 'https://web.push.apple.com/dana', keys: { p256dh: 'k', auth: 'a' } });
    const id = (await post(dana)).body.post.id;
    await post(ron, { kind: 'suggestion', text: 'עוד דוגמאות בבקשה' });
    const patch = (body: object, auth: Auth = lect) => api().patch(`/api/posts/${id}`).set(auth).send(body);

    expect((await patch({ pinned: true })).body.post.pinned).toBe(true);
    expect((await feed(ron))[0].id).toBe(id); // pinned first

    const answered = await patch({ reply: 'פונקציה שקוראת לעצמה' });
    expect(answered.body.post).toMatchObject({ status: 'answered', reply: { text: 'פונקציה שקוראת לעצמה' } });
    await settlePushes();
    expect(sent).toEqual(['https://web.push.apple.com/dana|המרצה הגיב/ה · מבוא']);

    await patch({ hidden: true });
    expect((await feed(ron)).map((p) => p.id)).not.toContain(id);
    expect((await feed(dana)).find((p) => p.id === id)).toMatchObject({ hidden: true });
    expect((await feed(lect)).map((p) => p.id)).toContain(id);

    expect((await patch({ pinned: 'yes' })).status).toBe(400);
    expect((await patch({ pinned: false }, dana)).status).toBe(403);
  });

  it('students delete only their own posts; the lecturer any', async () => {
    const { post, dana, ron, lect } = await setup();
    const a = (await post(dana)).body.post.id;
    const b = (await post(dana)).body.post.id;
    expect((await api().delete(`/api/posts/${a}`).set(ron)).status).toBe(404);
    expect((await api().delete(`/api/posts/${a}`).set(dana)).status).toBe(200);
    expect((await api().delete(`/api/posts/${b}`).set(lect)).status).toBe(200);
    expect(await Post.countDocuments()).toBe(0);
  });

  it('feeds the dashboard count of open questions', async () => {
    const { post, dana, lect, course } = await setup();
    const id = (await post(dana)).body.post.id;
    await post(dana, { kind: 'suggestion' });
    await post(dana);
    await api().patch(`/api/posts/${id}`).set(lect).send({ status: 'answered' });
    const dash = await api().get(`/api/courses/${course.id}/dashboard`).set(lect);
    expect(dash.body.feed).toEqual({ openQuestions: 1, totalPosts: 3 });
  });
});
