import { Router } from 'express';
import { config } from '../config.js';
import { isAllowedEndpoint, notifyUsers } from '../lib/push.js';
import { requireAuth } from '../middleware/auth.js';
import { PushSubscription } from '../models/PushSubscription.js';

export const pushRouter = Router();

/** The VAPID public key the browser needs to subscribe; null when push isn't configured. */
pushRouter.get('/public-key', (_req, res) => {
  res.json({ publicKey: config.vapid?.publicKey ?? null });
});

pushRouter.use(requireAuth);

function readSubscription(body: unknown) {
  const { endpoint, keys } = (body ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof endpoint !== 'string' || endpoint.length > 2000 || !isAllowedEndpoint(endpoint)) return null;
  if (typeof keys?.p256dh !== 'string' || typeof keys.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/** Save this device for the logged-in user (a device that switches account moves to the new user). */
pushRouter.post('/subscribe', async (req, res) => {
  const sub = readSubscription(req.body);
  if (!sub) {
    res.status(400).json({ error: 'Invalid subscription' });
    return;
  }
  await PushSubscription.updateOne({ endpoint: sub.endpoint }, { $set: { ...sub, userId: req.auth!.sub } }, { upsert: true });
  res.status(201).json({ ok: true });
});

pushRouter.post('/unsubscribe', async (req, res) => {
  const { endpoint } = (req.body ?? {}) as { endpoint?: unknown };
  if (typeof endpoint !== 'string') {
    res.status(400).json({ error: 'Invalid subscription' });
    return;
  }
  await PushSubscription.deleteOne({ endpoint, userId: req.auth!.sub });
  res.json({ ok: true });
});

/** Sends a test notification to all of the caller's devices. */
pushRouter.post('/test', async (req, res) => {
  const result = await notifyUsers([req.auth!.sub], {
    title: 'Class Companion',
    body: 'ההתראות עובדות ✓',
    url: '/courses',
    tag: 'test',
  });
  res.json(result);
});
