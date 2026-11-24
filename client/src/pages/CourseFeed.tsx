import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, POST_MAX_LENGTH, type CourseFeed as Feed, type FeedPost, type PostKind } from '../api';
import { useAuth } from '../auth';
import StudentCourseTabs from '../components/StudentCourseTabs';
import { ErrorBox } from '../components/ui';
import { dropQueued, enqueue, flush, isTransient, newClientId, queued, sendPost, type QueuedPost } from '../outbox';

const POLL_MS = 5000;
const KIND = {
  question: { icon: '❓', label: 'שאלה' },
  suggestion: { icon: '💡', label: 'הצעה' },
} as const;

const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' });
function ago(iso: string) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (s > -60) return 'עכשיו';
  if (s > -3600) return rtf.format(Math.round(s / 60), 'minute');
  if (s > -86400) return rtf.format(Math.round(s / 3600), 'hour');
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
}

type Sort = 'top' | 'new';
type Filter = 'open' | 'answered' | 'all';

function sortPosts(posts: FeedPost[], sort: Sort) {
  return [...posts].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      (sort === 'top' ? b.votes - a.votes : 0) ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1 ${value === v ? 'bg-white font-medium shadow-sm' : 'text-slate-600'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Student composer. Failed sends (offline) go to the outbox and are retried automatically. */
function Composer({ courseId, userId, onQueued, onSent }: { courseId: string; userId: string; onQueued: () => void; onSent: (p: FeedPost) => void }) {
  const [kind, setKind] = useState<PostKind>('question');
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    const item: QueuedPost = { courseId, clientId: newClientId(), kind, text: body, anonymous, queuedAt: new Date().toISOString() };
    setBusy(true);
    setError('');
    try {
      if (!navigator.onLine) throw Object.assign(new Error('offline'), { status: 0 });
      onSent((await sendPost(item)).post);
      setText('');
    } catch (err) {
      if (isTransient(err) || (err as { status?: number }).status === 0) {
        enqueue(userId, item);
        onQueued();
        setText('');
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  const left = POST_MAX_LENGTH - text.length;
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          ['question', `${KIND.question.icon} שאלה`],
          ['suggestion', `${KIND.suggestion.icon} הצעה`],
        ]}
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, POST_MAX_LENGTH))}
        rows={3}
        placeholder={kind === 'question' ? 'מה לא ברור? שאלו כאן — גם באמצע השיעור' : 'הצעה לשיפור הקורס או השיעור'}
        className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} className="h-4 w-4" />
          פרסום אנונימי
          <span className="text-xs text-slate-500">(המרצה עדיין יראה את שמך)</span>
        </label>
        <span className="flex items-center gap-3">
          <span className={`text-xs tabular-nums ${left < 50 ? 'text-amber-700' : 'text-slate-400'}`}>{left}</span>
          <button type="submit" disabled={busy || !text.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? '…' : 'שליחה'}
          </button>
        </span>
      </div>
      <ErrorBox>{error}</ErrorBox>
    </form>
  );
}

function QueuedItem({ q, onDrop }: { q: QueuedPost; onDrop: () => void }) {
  return (
    <li className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-4">
      <p className="whitespace-pre-wrap text-slate-700">
        {KIND[q.kind].icon} {q.text}
      </p>
      <p className={`mt-2 text-xs ${q.error ? 'text-red-700' : 'text-slate-500'}`}>
        {q.error ? `לא נשלח: ${q.error}` : '⏳ ממתין לחיבור — יישלח אוטומטית'}
        <button type="button" onClick={onDrop} className="ms-3 underline">
          מחיקה
        </button>
      </p>
    </li>
  );
}

function PostCard({ p, lecturer, onChange, onRemove }: { p: FeedPost; lecturer: boolean; onChange: (p: FeedPost) => void; onRemove: (id: string) => void }) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState(p.reply?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(path: string, init: Parameters<typeof api>[1]) {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ post?: FeedPost }>(path, init);
      if (r.post) onChange(r.post);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const patch = (body: object) => run(`/posts/${p.id}`, { method: 'PATCH', json: body });

  async function remove() {
    if (!window.confirm('למחוק את ההודעה?')) return;
    if (await run(`/posts/${p.id}`, { method: 'DELETE' })) onRemove(p.id);
  }

  return (
    <li className={`rounded-xl bg-white p-4 shadow-sm ring-1 ${p.pinned ? 'ring-indigo-300' : 'ring-slate-200'} ${p.hidden ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span className="font-medium text-slate-700">
              {KIND[p.kind].icon} {KIND[p.kind].label}
            </span>
            <span>· {p.author ?? 'סטודנט/ית אנונימי/ת'}</span>
            {p.anonymous && (lecturer || p.mine) && <span className="rounded bg-slate-100 px-1.5 py-0.5">אנונימי לסטודנטים</span>}
            <span>· {ago(p.createdAt)}</span>
            {p.duringClass && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">בזמן שיעור</span>}
            {p.pinned && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700">📌 נעוץ</span>}
            {p.status === 'answered' && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">✓ נענה</span>}
            {p.hidden && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">מוסתר מהסטודנטים</span>}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap break-words">{p.text}</p>
          {p.reply && !replying && (
            <div className="mt-3 rounded-lg bg-indigo-50 p-3 text-sm">
              <span className="font-medium text-indigo-800">תגובת המרצה: </span>
              <span className="whitespace-pre-wrap">{p.reply.text}</span>
            </div>
          )}
        </div>

        {lecturer || p.mine ? (
          <span className="shrink-0 rounded-lg px-2 py-1 text-center text-sm tabular-nums text-slate-500" title="הצבעות">
            👍 {p.votes}
          </span>
        ) : (
          <button
            type="button"
            disabled={busy}
            aria-pressed={p.votedByMe}
            onClick={() => run(`/posts/${p.id}/vote`, { method: 'POST', json: { up: !p.votedByMe } })}
            className={`shrink-0 rounded-lg px-2.5 py-1 text-sm tabular-nums ring-1 transition disabled:opacity-60 ${
              p.votedByMe ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'
            }`}
          >
            👍 {p.votes}
          </button>
        )}
      </div>

      {replying && (
        <div className="mt-3 space-y-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            autoFocus
            placeholder="תגובה קצרה (הסטודנט/ית יקבל/תקבל התראה)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => (await patch({ reply })) && setReplying(false)}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              שמירה
            </button>
            <button type="button" onClick={() => setReplying(false)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600">
              ביטול
            </button>
          </div>
        </div>
      )}

      {(lecturer || p.mine) && !replying && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-sm">
          {lecturer && (
            <>
              <button type="button" disabled={busy} onClick={() => patch({ status: p.status === 'answered' ? 'open' : 'answered' })} className="text-emerald-700 hover:underline">
                {p.status === 'answered' ? 'סמן כפתוח' : '✓ סמן כנענה'}
              </button>
              <button type="button" disabled={busy} onClick={() => setReplying(true)} className="text-indigo-700 hover:underline">
                {p.reply ? 'עריכת תגובה' : 'תגובה'}
              </button>
              <button type="button" disabled={busy} onClick={() => patch({ pinned: !p.pinned })} className="text-slate-600 hover:underline">
                {p.pinned ? 'ביטול נעיצה' : '📌 נעיצה'}
              </button>
              <button type="button" disabled={busy} onClick={() => patch({ hidden: !p.hidden })} className="text-slate-600 hover:underline">
                {p.hidden ? 'הצג לסטודנטים' : 'הסתר'}
              </button>
            </>
          )}
          <button type="button" disabled={busy} onClick={remove} className="text-red-700 hover:underline">
            מחיקה
          </button>
        </div>
      )}
      <ErrorBox>{error}</ErrorBox>
    </li>
  );
}

/** Course questions & suggestions. Students post and vote; the lecturer answers, pins and hides. */
export default function CourseFeed() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const lecturer = user?.role === 'lecturer';
  const userId = user?.id ?? '';
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<Sort>('top');
  const [filter, setFilter] = useState<Filter>('open');
  const [outbox, setOutbox] = useState<QueuedPost[]>(() => (userId ? queued(userId, id) : []));
  const [offline, setOffline] = useState(!navigator.onLine);

  const refreshOutbox = useCallback(() => setOutbox(userId ? queued(userId, id) : []), [userId, id]);

  const load = useCallback(async () => {
    if (!lecturer && userId && queued(userId, id).length) {
      await flush(userId, id);
      refreshOutbox();
    }
    try {
      setFeed(await api<Feed>(`/courses/${id}/posts`));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, lecturer, userId, refreshOutbox]);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
    const online = () => {
      setOffline(false);
      load();
    };
    const off = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', off);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', off);
    };
  }, [load]);

  const replace = (p: FeedPost) => setFeed((f) => f && { ...f, posts: f.posts.some((x) => x.id === p.id) ? f.posts.map((x) => (x.id === p.id ? p : x)) : [p, ...f.posts] });
  const remove = (postId: string) => setFeed((f) => f && { ...f, posts: f.posts.filter((x) => x.id !== postId) });

  const posts = useMemo(() => {
    const all = feed?.posts ?? [];
    const shown = !lecturer || filter === 'all' ? all : all.filter((p) => !p.hidden && (filter === 'open' ? p.status === 'open' : p.status === 'answered'));
    return sortPosts(shown, sort);
  }, [feed, lecturer, filter, sort]);

  const openCount = feed?.posts.filter((p) => p.kind === 'question' && p.status === 'open' && !p.hidden).length ?? 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {lecturer ? (
        <div>
          <Link to={`/courses/${id}`} className="text-sm text-slate-500 hover:underline">
            → {feed?.course.name ?? 'חזרה לקורס'}
          </Link>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-bold">שאלות והערות</h1>
            <Link to={`/courses/${id}/feed/present`} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
              מסך הקרנה
            </Link>
          </div>
          <p className="text-sm text-slate-500">{openCount} שאלות פתוחות</p>
        </div>
      ) : (
        <div className="space-y-3">
          <Link to="/courses" className="text-sm text-slate-500 hover:underline">
            → הקורסים שלי
          </Link>
          {feed && <h1 className="text-xl font-bold">{feed.course.name}</h1>}
          <StudentCourseTabs courseId={id} active="feed" />
        </div>
      )}

      {offline && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">אין חיבור לאינטרנט — אפשר לכתוב, וההודעות יישלחו כשהחיבור יחזור.</p>}

      {!lecturer && userId && <Composer courseId={id} userId={userId} onQueued={refreshOutbox} onSent={replace} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {lecturer ? (
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              ['open', 'פתוחות'],
              ['answered', 'נענו'],
              ['all', 'הכל'],
            ]}
          />
        ) : (
          <span />
        )}
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            ['top', 'הכי מבוקשות'],
            ['new', 'חדשות'],
          ]}
        />
      </div>

      <ErrorBox>{error}</ErrorBox>
      {!feed && !error && <p className="text-center text-slate-500">טוען…</p>}

      <ul className="space-y-3">
        {outbox.map((q) => (
          <QueuedItem
            key={q.clientId}
            q={q}
            onDrop={() => {
              dropQueued(userId, q.clientId);
              refreshOutbox();
            }}
          />
        ))}
        {posts.map((p) => (
          <PostCard key={p.id} p={p} lecturer={lecturer} onChange={replace} onRemove={remove} />
        ))}
      </ul>

      {feed && posts.length === 0 && outbox.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
          {lecturer ? (filter === 'open' ? 'אין שאלות פתוחות.' : 'אין הודעות כאן.') : 'עוד אין שאלות או הצעות. היו הראשונים!'}
        </div>
      )}
    </div>
  );
}
