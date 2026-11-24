import { Router } from 'express';
import mongoose from 'mongoose';
import { findAccessibleCourse } from '../lib/access.js';
import { notifyInBackground } from '../lib/push.js';
import { closeExpiredSessions } from '../lib/sessions.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { POST_KINDS, POST_MAX_LENGTH, Post, REPLY_MAX_LENGTH, type PostDoc } from '../models/Post.js';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';

/** Mounted at /api: /courses/:id/posts and /posts/:postId. */
export const postsRouter = Router();

/** At most this many posts per student per minute. */
export const POST_RATE_LIMIT = 5;

type Viewer = { sub: string; role: string };
type CourseLike = { id: string; name: string; roster: { email: string; firstName: string; lastName: string }[] };

/** Author display names, from the roster (accounts may have no name). */
async function authorNames(posts: PostDoc[], course: CourseLike) {
  const users = await User.find({ _id: { $in: [...new Set(posts.map((p) => String(p.authorId)))] } }, { email: 1, firstName: 1, lastName: 1 });
  const rosterByEmail = new Map(course.roster.map((r) => [r.email.toLowerCase(), r]));
  return new Map(
    users.map((u) => {
      const r = rosterByEmail.get(u.email);
      const name = `${r?.firstName || u.firstName} ${r?.lastName || u.lastName}`.trim() || u.email.split('@')[0];
      return [String(u._id), name];
    }),
  );
}

/** What a viewer may see. Students never receive an anonymous post's author (unless it's theirs). */
function toView(p: PostDoc, viewer: Viewer, names: Map<string, string>) {
  const mine = String(p.authorId) === viewer.sub;
  const lecturer = viewer.role === 'lecturer';
  const showAuthor = lecturer || mine || !p.anonymous;
  return {
    id: p.id as string,
    kind: p.kind,
    text: p.text,
    createdAt: p.createdAt,
    duringClass: !!p.sessionId,
    author: showAuthor ? (names.get(String(p.authorId)) ?? '') : null,
    anonymous: p.anonymous,
    mine,
    votes: p.voterIds.length,
    votedByMe: p.voterIds.some((v) => String(v) === viewer.sub),
    status: p.status,
    pinned: p.pinned,
    hidden: p.hidden,
    reply: p.reply ? { text: p.reply.text, at: p.reply.at } : null,
  };
}

async function viewOne(p: PostDoc, viewer: Viewer, course: CourseLike) {
  return toView(p, viewer, await authorNames([p], course));
}

/** Course feed. Students don't get posts the lecturer hid (except their own). Pinned first, then newest. */
postsRouter.get('/courses/:id/posts', requireAuth, async (req, res) => {
  const course = await findAccessibleCourse(String(req.params.id), req.auth!);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const viewer = req.auth!;
  const filter =
    viewer.role === 'lecturer'
      ? { courseId: course._id }
      : { courseId: course._id, $or: [{ hidden: false }, { authorId: viewer.sub }] };
  const posts = await Post.find(filter).sort({ pinned: -1, createdAt: -1 }).limit(500);
  const names = await authorNames(posts, course);
  res.json({ course: { id: course.id, name: course.name }, posts: posts.map((p) => toView(p, viewer, names)), serverNow: new Date() });
});

/** Student posts a question/suggestion. Idempotent per clientId (safe to retry from the offline queue). */
postsRouter.post('/courses/:id/posts', requireAuth, requireRole('student'), async (req, res) => {
  const course = await findAccessibleCourse(String(req.params.id), req.auth!);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  const { kind, text, anonymous, clientId } = (req.body ?? {}) as Record<string, unknown>;
  const body = typeof text === 'string' ? text.trim() : '';
  if (!POST_KINDS.includes(kind as (typeof POST_KINDS)[number]) || typeof clientId !== 'string' || !clientId || clientId.length > 64) {
    res.status(400).json({ error: 'Invalid post' });
    return;
  }
  if (!body) {
    res.status(400).json({ error: 'Post text is required' });
    return;
  }
  if (body.length > POST_MAX_LENGTH) {
    res.status(400).json({ error: 'Post is too long', maxLength: POST_MAX_LENGTH });
    return;
  }
  const viewer = req.auth!;
  const existing = await Post.findOne({ authorId: viewer.sub, clientId });
  if (existing) {
    res.status(200).json({ post: await viewOne(existing, viewer, course) });
    return;
  }
  const recent = await Post.countDocuments({ authorId: viewer.sub, createdAt: { $gt: new Date(Date.now() - 60_000) } });
  if (recent >= POST_RATE_LIMIT) {
    res.status(429).json({ error: 'Too many posts, wait a minute' });
    return;
  }
  await closeExpiredSessions({ courseId: course._id });
  const active = await Session.findOne({ courseId: course._id, status: 'active' }, { _id: 1 });
  try {
    const post = await Post.create({
      courseId: course._id,
      sessionId: active?._id as mongoose.Types.ObjectId | undefined,
      authorId: viewer.sub,
      clientId,
      kind: kind as (typeof POST_KINDS)[number],
      text: body,
      anonymous: anonymous === true,
    });
    res.status(201).json({ post: await viewOne(post, viewer, course) });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      const again = await Post.findOne({ authorId: viewer.sub, clientId });
      res.status(200).json({ post: again && (await viewOne(again, viewer, course)) });
      return;
    }
    throw e;
  }
});

/** Loads a post the viewer can see, with its course. */
async function findVisiblePost(postId: string, viewer: Viewer) {
  if (!mongoose.isValidObjectId(postId)) return null;
  const post = await Post.findById(postId);
  if (!post) return null;
  const course = await findAccessibleCourse(String(post.courseId), viewer);
  if (!course) return null;
  if (viewer.role !== 'lecturer' && post.hidden && String(post.authorId) !== viewer.sub) return null;
  return { post, course };
}

/** Student 👍 / un-👍 someone else's post. */
postsRouter.post('/posts/:postId/vote', requireAuth, requireRole('student'), async (req, res) => {
  const found = await findVisiblePost(String(req.params.postId), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  const { up } = (req.body ?? {}) as { up?: unknown };
  if (typeof up !== 'boolean') {
    res.status(400).json({ error: 'Expected { up }' });
    return;
  }
  const viewer = req.auth!;
  if (String(found.post.authorId) === viewer.sub) {
    res.status(400).json({ error: 'Cannot vote for your own post' });
    return;
  }
  const updated = await Post.findByIdAndUpdate(
    found.post._id,
    up ? { $addToSet: { voterIds: viewer.sub } } : { $pull: { voterIds: viewer.sub } },
    { new: true },
  );
  res.json({ post: await viewOne(updated!, viewer, found.course) });
});

/** Lecturer: answered / pinned / hidden / reply (empty reply removes it). Notifies the author when answered. */
postsRouter.patch('/posts/:postId', requireAuth, requireRole('lecturer'), async (req, res) => {
  const found = await findVisiblePost(String(req.params.postId), req.auth!);
  if (!found) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  const { status, pinned, hidden, reply } = (req.body ?? {}) as Record<string, unknown>;
  const { post, course } = found;
  if (
    (status !== undefined && status !== 'open' && status !== 'answered') ||
    (pinned !== undefined && typeof pinned !== 'boolean') ||
    (hidden !== undefined && typeof hidden !== 'boolean') ||
    (reply !== undefined && typeof reply !== 'string')
  ) {
    res.status(400).json({ error: 'Invalid update' });
    return;
  }
  if (typeof reply === 'string' && reply.trim().length > REPLY_MAX_LENGTH) {
    res.status(400).json({ error: 'Reply is too long', maxLength: REPLY_MAX_LENGTH });
    return;
  }
  const wasAnswered = post.status === 'answered';
  const hadReply = !!post.reply;
  if (typeof pinned === 'boolean') post.pinned = pinned;
  if (typeof hidden === 'boolean') post.hidden = hidden;
  if (typeof reply === 'string') {
    const t = reply.trim();
    post.set('reply', t ? { text: t, at: new Date() } : undefined);
    if (t && status === undefined) post.status = 'answered'; // a reply answers the post
  }
  if (status === 'open' || status === 'answered') post.status = status;
  await post.save();

  const newlyAnswered = post.status === 'answered' && !wasAnswered;
  const newReply = !!post.reply && !hadReply;
  if ((newlyAnswered || newReply) && !post.hidden) {
    notifyInBackground([String(post.authorId)], {
      title: post.reply ? `המרצה הגיב/ה · ${course.name}` : `השאלה שלך סומנה כנענתה · ${course.name}`,
      body: post.reply ? post.reply.text.slice(0, 140) : post.text.slice(0, 140),
      url: `/courses/${course.id}/feed`,
      tag: `post-${post.id}`,
    });
  }
  res.json({ post: await viewOne(post, req.auth!, course) });
});

/** Students may delete their own posts; the lecturer any post in their course. */
postsRouter.delete('/posts/:postId', requireAuth, async (req, res) => {
  const found = await findVisiblePost(String(req.params.postId), req.auth!);
  const viewer = req.auth!;
  if (!found || (viewer.role !== 'lecturer' && String(found.post.authorId) !== viewer.sub)) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  await found.post.deleteOne();
  res.json({ ok: true });
});

/** Used by the dashboard. */
export const countOpenQuestions = (courseId: mongoose.Types.ObjectId) =>
  Post.countDocuments({ courseId, kind: 'question', status: 'open', hidden: false });
