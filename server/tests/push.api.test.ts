import { afterEach, describe, expect, it } from 'vitest';
import { isAllowedEndpoint, setPushSender, settlePushes, type PushSender } from '../src/lib/push';
import { Course } from '../src/models/Course';
import { PushSubscription } from '../src/models/PushSubscription';
import { api, createLecturer, loginToken, useTestDb } from './helpers';

useTestDb();

const APPLE = 'https://web.push.apple.com/QF_abc';
const sub = (endpoint = APPLE) => ({ endpoint, keys: { p256dh: 'BPk-key', auth: 'auth-secret' } });

async function signup(email: string) {
  const res = await api().post('/api/auth/signup').send({ email, password: 'secret123' });
  return { Authorization: `Bearer ${res.body.token}` };
}

/** Records every send; endpoints listed in `fail` throw with that status code. */
function fakeSender(fail: Record<string, number> = {}) {
  const sent: { endpoint: string; payload: { title: string; url: string }; ttl: number }[] = [];
  const sender: PushSender = async (target, payload, options) => {
    if (fail[target.endpoint]) throw Object.assign(new Error('push error'), { statusCode: fail[target.endpoint] });
    sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload), ttl: options.TTL });
  };
  setPushSender(sender);
  return sent;
}

afterEach(() => setPushSender(null));

describe('endpoint allowlist', () => {
  it('accepts real push services and rejects anything else', () => {
    expect(isAllowedEndpoint(APPLE)).toBe(true);
    expect(isAllowedEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isAllowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isAllowedEndpoint('http://web.push.apple.com/x')).toBe(false);
    expect(isAllowedEndpoint('https://evil.com/push.apple.com')).toBe(false);
    expect(isAllowedEndpoint('https://push.apple.com.evil.com/x')).toBe(false);
    expect(isAllowedEndpoint('https://127.0.0.1/x')).toBe(false);
    expect(isAllowedEndpoint('not a url')).toBe(false);
  });
});

describe('POST /api/push/subscribe & unsubscribe', () => {
  it('requires login', async () => {
    expect((await api().post('/api/push/subscribe').send(sub())).status).toBe(401);
  });

  it('stores one subscription per device and moves it if another user logs in on it', async () => {
    const dana = await signup('dana@uni.ac.il');
    expect((await api().post('/api/push/subscribe').set(dana).send(sub())).status).toBe(201);
    expect((await api().post('/api/push/subscribe').set(dana).send(sub())).status).toBe(201);
    expect(await PushSubscription.countDocuments()).toBe(1);

    const ron = await signup('ron@uni.ac.il');
    await api().post('/api/push/subscribe').set(ron).send(sub());
    const saved = await PushSubscription.find();
    expect(saved).toHaveLength(1);
    expect(String(saved[0].userId)).toBe((await api().get('/api/auth/me').set(ron)).body.user.id);
  });

  it('rejects malformed subscriptions and non-push endpoints', async () => {
    const dana = await signup('dana@uni.ac.il');
    for (const body of [{}, { endpoint: APPLE }, sub('https://example.com/hook'), { ...sub(), keys: { p256dh: 1, auth: 'x' } }]) {
      expect((await api().post('/api/push/subscribe').set(dana).send(body)).status).toBe(400);
    }
  });

  it('only removes your own subscription', async () => {
    const dana = await signup('dana@uni.ac.il');
    const ron = await signup('ron@uni.ac.il');
    await api().post('/api/push/subscribe').set(dana).send(sub());
    await api().post('/api/push/unsubscribe').set(ron).send({ endpoint: APPLE });
    expect(await PushSubscription.countDocuments()).toBe(1);
    await api().post('/api/push/unsubscribe').set(dana).send({ endpoint: APPLE });
    expect(await PushSubscription.countDocuments()).toBe(0);
  });
});

describe('GET /api/push/public-key', () => {
  it('answers without login (null when VAPID is not configured)', async () => {
    const res = await api().get('/api/push/public-key');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('publicKey');
  });
});

describe('notifications when attendance opens', () => {
  async function setup() {
    const lect = await createLecturer();
    const course = await Course.create({
      name: 'מבוא',
      lecturerId: lect._id,
      roster: [
        { email: 'dana@uni.ac.il', firstName: 'דנה', lastName: 'כהן' },
        { email: 'ron@uni.ac.il', firstName: 'רון', lastName: 'לוי' },
      ],
    });
    const dana = await signup('dana@uni.ac.il');
    const ron = await signup('ron@uni.ac.il');
    const outsider = await signup('out@uni.ac.il');
    await api().post('/api/push/subscribe').set(dana).send(sub('https://web.push.apple.com/dana'));
    await api().post('/api/push/subscribe').set(ron).send(sub('https://fcm.googleapis.com/fcm/send/ron'));
    await api().post('/api/push/subscribe').set(outsider).send(sub('https://web.push.apple.com/out'));
    const lectAuth = { Authorization: `Bearer ${await loginToken('lect@uni.ac.il')}` };
    const start = () => api().post(`/api/courses/${course.id}/sessions`).set(lectAuth).send({ lat: 32.1, lng: 34.8, accuracy: 10 });
    return { course, start };
  }

  it("notifies only the course's students, linking to check-in", async () => {
    const sent = fakeSender();
    const { course, start } = await setup();
    expect((await start()).status).toBe(201);
    await settlePushes();
    expect(sent.map((s) => s.endpoint).sort()).toEqual(['https://fcm.googleapis.com/fcm/send/ron', 'https://web.push.apple.com/dana']);
    expect(sent[0].payload).toMatchObject({ title: 'הנוכחות נפתחה · מבוא', url: `/courses/${course.id}/checkin` });
    expect(sent[0].ttl).toBe(15 * 60);
  });

  it('deletes subscriptions the push service says are gone, keeps others on other errors', async () => {
    fakeSender({ 'https://web.push.apple.com/dana': 410, 'https://fcm.googleapis.com/fcm/send/ron': 500 });
    const { start } = await setup();
    await start();
    await settlePushes();
    const left = (await PushSubscription.find()).map((s) => s.endpoint).sort();
    expect(left).toEqual(['https://fcm.googleapis.com/fcm/send/ron', 'https://web.push.apple.com/out']);
  });

  it('POST /api/push/test sends to the caller only', async () => {
    const sent = fakeSender();
    const dana = await signup('dana@uni.ac.il');
    await signup('ron@uni.ac.il').then((ron) => api().post('/api/push/subscribe').set(ron).send(sub('https://web.push.apple.com/ron')));
    await api().post('/api/push/subscribe').set(dana).send(sub());
    const res = await api().post('/api/push/test').set(dana);
    expect(res.body).toEqual({ sent: 1, removed: 0 });
    expect(sent.map((s) => s.endpoint)).toEqual([APPLE]);
  });
});
