import { sendNotification } from 'web-push';
import { ATTENDANCE_RULES } from '../../../shared/attendance.js';
import { config } from '../config.js';
import { PushSubscription } from '../models/PushSubscription.js';
import { User } from '../models/User.js';

export interface PushPayload {
  title: string;
  body: string;
  /** Path the notification opens, e.g. /courses/123/checkin. */
  url: string;
  /** Same tag replaces an earlier notification instead of stacking. */
  tag?: string;
}

interface Target {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type PushSender = (target: Target, payload: string, options: { TTL: number; urgency: 'high' }) => Promise<void>;

/** Real push services only — the server makes requests to these URLs, so never accept arbitrary hosts. */
const PUSH_HOST_SUFFIXES = ['push.apple.com', 'fcm.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com'];

export function isAllowedEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOST_SUFFIXES.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const webPushSender: PushSender = async (target, payload, options) => {
  const vapid = config.vapid;
  if (!vapid) return;
  await sendNotification(target, payload, {
    ...options,
    vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
  });
};

let sender: PushSender = webPushSender;
/** Tests swap in a fake sender. */
export function setPushSender(s: PushSender | null) {
  sender = s ?? webPushSender;
}

const pending = new Set<Promise<unknown>>();
/** Resolves once background sends started so far have finished (used by tests). */
export const settlePushes = () => Promise.allSettled([...pending]);

/** Sends to every device of the given users. Expired subscriptions (404/410) are deleted. */
export async function notifyUsers(userIds: string[], payload: PushPayload, ttlSeconds = 60 * 60) {
  if (userIds.length === 0) return { sent: 0, removed: 0 };
  const subs = await PushSubscription.find({ userId: { $in: userIds } });
  const body = JSON.stringify(payload);
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sender({ endpoint: s.endpoint, keys: { p256dh: s.keys!.p256dh, auth: s.keys!.auth } }, body, { TTL: ttlSeconds, urgency: 'high' });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.endpoint);
        else console.error('push failed', status ?? '', (e as Error).message);
      }
    }),
  );
  if (gone.length) await PushSubscription.deleteMany({ endpoint: { $in: gone } });
  return { sent, removed: gone.length };
}

/** Fire-and-forget notifyUsers (tracked so tests can wait for it). */
export function notifyInBackground(userIds: string[], payload: PushPayload, ttlSeconds?: number) {
  track(notifyUsers(userIds, payload, ttlSeconds).catch((e) => console.error('notify failed', e)));
}

function track(job: Promise<unknown>) {
  pending.add(job);
  void job.finally(() => pending.delete(job));
}

/** Notifies every signed-up student on a course's roster (in the background). */
export function notifyCourseStudents(course: { roster: { email: string }[] }, payload: PushPayload, ttlSeconds?: number) {
  const job = (async () => {
    const students = await User.find({ email: { $in: course.roster.map((r) => r.email) }, role: 'student' }, { _id: 1 });
    return notifyUsers(students.map((u) => String(u._id)), payload, ttlSeconds);
  })().catch((e) => console.error('notify failed', e));
  track(job);
}

/** Tells the course's (signed-up) students that attendance is open. Runs in the background. */
export function announceSessionStarted(course: { id: string; name: string; roster: { email: string }[] }) {
  const job = (async () => {
    const students = await User.find({ email: { $in: course.roster.map((r) => r.email) }, role: 'student' }, { _id: 1 });
    return notifyUsers(
      students.map((u) => String(u._id)),
      {
        title: `הנוכחות נפתחה · ${course.name}`,
        body: `פתחו את האפליקציה וסמנו "אני כאן". הנוכחות פתוחה ${ATTENDANCE_RULES.defaultSessionMinutes} דקות.`,
        url: `/courses/${course.id}/checkin`,
        tag: `attendance-${course.id}`,
      },
      ATTENDANCE_RULES.defaultSessionMinutes * 60,
    );
  })().catch((e) => console.error('announce failed', e));
  track(job);
}
