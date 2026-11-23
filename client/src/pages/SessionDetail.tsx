import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { SessionStatus } from '../api';
import SessionRoster from '../components/SessionRoster';

const when = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** One session's attendance, editable by the lecturer (live or after the fact). */
export default function SessionDetail() {
  const { id = '', sessionId = '' } = useParams();
  const [summary, setSummary] = useState<SessionStatus | null>(null);
  const live = summary?.session.status === 'active';

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link to={`/courses/${id}/sessions`} className="text-sm text-slate-500 hover:underline">
          → כל המפגשים
        </Link>
        {summary && (
          <>
            <h1 className="mt-1 text-xl font-bold">{when(summary.session.startsAt)}</h1>
            <p className="text-sm text-slate-500">
              {summary.session.courseName} · {summary.checkedInCount}/{summary.rosterCount} נוכחים
            </p>
          </>
        )}
      </div>
      {live && (
        <Link to={`/courses/${id}/attendance`} className="block rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100">
          ● המפגש עדיין פעיל — למסך הנוכחות החי ←
        </Link>
      )}
      <SessionRoster sessionId={sessionId} live={live} onSummary={setSummary} />
    </div>
  );
}
