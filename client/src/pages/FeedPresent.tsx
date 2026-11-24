import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type CourseFeed } from '../api';

const POLL_MS = 3000;
const SHOW = 6;

/** Full-screen view for the projector: open questions by votes, and a QR code to join. */
export default function FeedPresent() {
  const { id = '' } = useParams();
  const [feed, setFeed] = useState<CourseFeed | null>(null);
  const [qr, setQr] = useState('');
  const joinUrl = `${window.location.origin}/courses/${id}/feed`;

  useEffect(() => {
    QRCode.toDataURL(joinUrl, { width: 320, margin: 1 }).then(setQr, () => setQr(''));
  }, [joinUrl]);

  useEffect(() => {
    const load = () => api<CourseFeed>(`/courses/${id}/posts`).then(setFeed, () => {});
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [id]);

  const open = (feed?.posts ?? [])
    .filter((p) => p.kind === 'question' && p.status === 'open' && !p.hidden)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.votes - a.votes || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return (
    <div className="min-h-dvh bg-bg p-6 text-ink lg:p-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="text-3xl lg:text-4xl">שאלות פתוחות{feed && ` · ${feed.course.name}`}</h1>
            <Link to={`/courses/${id}/feed`} className="shrink-0 text-sm text-ink-4 hover:text-ink">
              יציאה ממסך הקרנה
            </Link>
          </div>
          <ol className="mt-6 space-y-4">
            {open.slice(0, SHOW).map((p) => (
              <li key={p.id} className="flex items-start gap-5 rounded-2xl bg-elevated p-5">
                <span className="w-16 shrink-0 text-center text-3xl font-bold tabular-nums text-accent-ink">
                  {p.votes}
                  <span className="block text-sm font-normal text-ink-4">👍</span>
                </span>
                <p className="min-w-0 whitespace-pre-wrap break-words text-2xl leading-snug lg:text-3xl">
                  {p.pinned && <span className="me-3 rounded-lg bg-accent-soft px-2 py-0.5 align-middle text-base text-accent-ink">נעוץ</span>}
                  {p.text}
                </p>
              </li>
            ))}
          </ol>
          {feed && open.length === 0 && <p className="mt-10 text-2xl text-ink-4">אין כרגע שאלות פתוחות.</p>}
          {open.length > SHOW && <p className="mt-4 text-lg text-ink-4">ועוד {open.length - SHOW} שאלות…</p>}
        </div>
        <aside className="shrink-0 text-center lg:w-80">
          {qr && <img src={qr} alt="קוד QR להצטרפות" className="mx-auto w-64 card p-2 lg:w-72" />}
          <p className="mt-3 text-xl">סרקו כדי לשאול</p>
          <p className="mt-1 text-sm text-ink-4">אפשר לשאול באנונימיות</p>
        </aside>
      </div>
    </div>
  );
}
