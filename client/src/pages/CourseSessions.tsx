import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type CourseSessionsList } from '../api';
import { ErrorBox, BackLink } from '../components/ui';

const when = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' });

/** All attendance sessions of a course; each opens its roster for corrections. */
export default function CourseSessions() {
  const { id = '' } = useParams();
  const [data, setData] = useState<CourseSessionsList | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<CourseSessionsList>(`/courses/${id}/sessions`).then(setData, (e) => setError(e.message));
  }, [id]);

  if (!data) return error ? <ErrorBox>{error}</ErrorBox> : <p className="text-ink-3">טוען…</p>;

  return (
    <div className="space-y-4">
      <div>
        <BackLink to={`/courses/${id}`}>{data.course.name}</BackLink>
        <h1 className="mt-1 text-xl">מפגשים</h1>
        <p className="text-sm text-ink-3">בחרו מפגש כדי לראות מי נכח ולתקן נוכחות.</p>
      </div>

      {data.sessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2 p-8 text-center text-ink-2">עוד לא התקיימו מפגשים.</div>
      ) : (
        <ul className="divide-y divide-line card">
          {data.sessions.map((s) => {
            const live = s.status === 'active';
            return (
              <li key={s.id}>
                <Link to={`/courses/${id}/sessions/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface">
                  <span>
                    {when(s.startsAt)}
                    {live && <span className="ms-2 rounded-full bg-good-soft px-2 py-0.5 text-xs font-medium text-good">● פעיל</span>}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-ink-2">
                    {s.present}/{data.rosterCount}
                    
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
