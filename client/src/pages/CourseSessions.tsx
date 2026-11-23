import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type CourseSessionsList } from '../api';
import { ErrorBox } from '../components/ui';

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

  if (!data) return error ? <ErrorBox>{error}</ErrorBox> : <p className="text-slate-500">טוען…</p>;

  return (
    <div className="space-y-4">
      <div>
        <Link to={`/courses/${id}`} className="text-sm text-slate-500 hover:underline">
          → {data.course.name}
        </Link>
        <h1 className="mt-1 text-xl font-bold">מפגשים</h1>
        <p className="text-sm text-slate-500">בחרו מפגש כדי לראות מי נכח ולתקן נוכחות.</p>
      </div>

      {data.sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">עוד לא התקיימו מפגשים.</div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          {data.sessions.map((s) => {
            const live = s.status === 'active';
            return (
              <li key={s.id}>
                <Link to={`/courses/${id}/sessions/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                  <span>
                    {when(s.startsAt)}
                    {live && <span className="ms-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">● פעיל</span>}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-slate-600">
                    {s.present}/{data.rosterCount}
                    <span className="ms-2 text-slate-400">←</span>
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
