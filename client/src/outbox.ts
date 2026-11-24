import { api, ApiError, type FeedPost, type PostKind } from './api';

/** A post written while offline (or while the request failed), waiting to be sent. */
export interface QueuedPost {
  courseId: string;
  clientId: string;
  kind: PostKind;
  text: string;
  anonymous: boolean;
  queuedAt: string;
  /** Set when the server rejected it for good (the student can delete it). */
  error?: string;
}

const key = (userId: string) => `cc_outbox_${userId}`;

function read(userId: string): QueuedPost[] {
  try {
    const raw = localStorage.getItem(key(userId));
    return raw ? (JSON.parse(raw) as QueuedPost[]) : [];
  } catch {
    return [];
  }
}

function write(userId: string, items: QueuedPost[]) {
  try {
    if (items.length) localStorage.setItem(key(userId), JSON.stringify(items));
    else localStorage.removeItem(key(userId));
  } catch {
    /* storage unavailable: the queue lives only in memory for this page */
  }
}

export const newClientId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const queued = (userId: string, courseId: string) => read(userId).filter((q) => q.courseId === courseId);

export function enqueue(userId: string, item: QueuedPost) {
  write(userId, [...read(userId).filter((q) => q.clientId !== item.clientId), item]);
}

export function dropQueued(userId: string, clientId: string) {
  write(userId, read(userId).filter((q) => q.clientId !== clientId));
}

/** Sends one post; the server ignores repeats of the same clientId, so retrying is safe. */
export const sendPost = (q: QueuedPost) =>
  api<{ post: FeedPost }>(`/courses/${q.courseId}/posts`, {
    method: 'POST',
    json: { kind: q.kind, text: q.text, anonymous: q.anonymous, clientId: q.clientId },
  });

/** True for failures worth retrying later (no connection, rate limit, server hiccup). */
export const isTransient = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status === 429 || e.status >= 500);

/** Tries to send everything queued for this course. Returns how many were sent. */
export async function flush(userId: string, courseId: string): Promise<number> {
  let sent = 0;
  for (const q of queued(userId, courseId)) {
    if (q.error) continue;
    try {
      await sendPost(q);
      dropQueued(userId, q.clientId);
      sent++;
    } catch (e) {
      if (isTransient(e)) break; // still offline — keep the rest in order
      enqueue(userId, { ...q, error: (e as Error).message });
    }
  }
  return sent;
}
