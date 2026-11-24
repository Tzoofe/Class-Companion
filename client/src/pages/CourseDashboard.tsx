import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadFile, type CourseDashboard as Dashboard } from '../api';
import { ErrorBox } from '../components/ui';

const LIVE_POLL_MS = 5000;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
const longDate = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

function Tile({ label, value, sub, to }: { label: string; value: ReactNode; sub?: ReactNode; to?: string }) {
  const body = (
    <>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </>
  );
  const cls = 'block rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200';
  return to ? (
    <Link to={to} className={`${cls} transition hover:ring-indigo-300`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A dashboard section. New features (assignments, announcements, …) are added as more cards. */
function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Present-per-session bars (one series, so no legend). Hover/focus a bar for its exact numbers. */
function AttendanceChart({ courseId, history, rosterCount }: { courseId: string; history: Dashboard['history']; rosterCount: number }) {
  if (history.length === 0) return <p className="py-6 text-center text-sm text-slate-500">עוד לא התקיימו מפגשים.</p>;
  const max = Math.max(rosterCount, 1);
  const first = history[0];
  const last = history[history.length - 1];

  return (
    <figure>
      <div className="flex items-baseline justify-between text-xs text-slate-400">
        <span>{rosterCount} סטודנטים</span>
      </div>
      <div
        className="mt-1 flex h-36 items-end gap-[2px] border-b border-slate-300"
        role="list"
        aria-label="נוכחים בכל מפגש"
        dir="ltr"
      >
        {history.map((s) => {
          const pct = Math.round((s.present / max) * 100);
          const label = `${longDate(s.startsAt)}: ${s.present}/${rosterCount} (${pct}%)`;
          return (
            <Link
              key={s.id}
              to={`/courses/${courseId}/sessions/${s.id}`}
              role="listitem"
              aria-label={label}
              className="group relative flex h-full flex-1 items-end outline-none"
            >
              <div
                className="w-full rounded-t-[4px] bg-indigo-500 transition-colors group-hover:bg-indigo-700 group-focus-visible:bg-indigo-700"
                style={{ height: `${Math.max(pct, s.present > 0 ? 2 : 0)}%` }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-xs text-white shadow group-hover:block group-focus-visible:block">
                <div>{longDate(s.startsAt)}</div>
                <div className="font-semibold tabular-nums">
                  {s.present}/{rosterCount} · {pct}%
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      <figcaption className="mt-1 flex justify-between text-xs text-slate-500" dir="ltr">
        <span>{shortDate(first.startsAt)}</span>
        {history.length > 1 && <span>{shortDate(last.startsAt)}</span>}
      </figcaption>
    </figure>
  );
}

export default function CourseDashboard() {
  const { id = '' } = useParams();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  async function exportFile() {
    setExporting(true);
    setError('');
    try {
      await downloadFile(`/courses/${id}/export`, 'attendance.xlsx');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Dashboard>(`/courses/${id}/dashboard`)
        .then((d) => alive && (setData(d), setError('')))
        .catch((e) => alive && setError(e.message));
    load();
    return () => {
      alive = false;
    };
  }, [id]);

  // While a session is open, keep the live count fresh.
  const live = data?.live != null;
  useEffect(() => {
    if (!live) return;
    const poll = setInterval(() => api<Dashboard>(`/courses/${id}/dashboard`).then(setData, () => {}), LIVE_POLL_MS);
    return () => clearInterval(poll);
  }, [id, live]);

  if (!data)
    return error ? (
      <div className="space-y-3">
        <ErrorBox>{error}</ErrorBox>
        <Link to="/courses" className="text-sm text-indigo-700 underline">
          חזרה לקורסים
        </Link>
      </div>
    ) : (
      <p className="text-slate-500">טוען…</p>
    );

  const { course, rosterCount } = data;

  return (
    <div className="space-y-4">
      <div>
        <Link to="/courses" className="text-sm text-slate-500 hover:underline">
          → הקורסים שלי
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold">{course.name}</h1>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={exportFile}
              disabled={exporting}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              {exporting ? '…' : 'ייצוא'}
            </button>
            <Link
              to={`/courses/${course.id}/attendance`}
              className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${data.live ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
            >
              {data.live ? '● למפגש הפעיל' : 'התחל נוכחות'}
            </Link>
          </div>
        </div>
      </div>

      <ErrorBox>{error}</ErrorBox>

      {data.live && (
        <Link to={`/courses/${course.id}/attendance`} className="block rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200 hover:bg-emerald-100">
          <span className="text-sm font-medium text-emerald-800">● מפגש נוכחות פעיל</span>
          <span className="ms-2 text-lg font-bold tabular-nums text-emerald-900">
            {data.live.present}/{rosterCount}
          </span>
          <span className="ms-1 text-sm text-emerald-800">סימנו נוכחות</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="סטודנטים" value={rosterCount} sub={`${data.registeredCount} נרשמו לאפליקציה`} />
        <Tile label="נוכחות ממוצעת" value={data.averagePercent === null ? '—' : `${data.averagePercent}%`} sub="במפגשים שהסתיימו" />
        <Tile label="מפגשים" value={data.sessionCount} sub={data.live ? 'כולל המפגש הפעיל' : undefined} />
        <Tile
          label="מפגש אחרון"
          to={data.lastSession ? `/courses/${course.id}/sessions/${data.lastSession.id}` : undefined}
          value={data.lastSession ? `${data.lastSession.present}/${rosterCount}` : '—'}
          sub={data.lastSession ? `${longDate(data.lastSession.startsAt)} · עריכה ←` : 'עוד לא התקיים'}
        />
      </div>

      <Card
        title="נוכחות לפי מפגש"
        action={
          data.sessionCount > 0 && (
            <Link to={`/courses/${course.id}/sessions`} className="text-sm text-indigo-700 hover:underline">
              כל המפגשים ←
            </Link>
          )
        }
      >
        <AttendanceChart courseId={course.id} history={data.history} rosterCount={rosterCount} />
        {data.finishedSessionCount > data.history.length && (
          <p className="mt-1 text-xs text-slate-500">מוצגים {data.history.length} המפגשים האחרונים. לחצו על עמודה כדי לראות ולתקן את הנוכחות.</p>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card
          title="דורשים תשומת לב"
          action={
            <Link to={`/courses/${course.id}/students`} className="text-sm text-indigo-700 hover:underline">
              כל הסטודנטים ←
            </Link>
          }
        >
          {data.finishedSessionCount === 0 ? (
            <p className="text-sm text-slate-500">יופיע אחרי המפגש הראשון.</p>
          ) : data.atRisk.length === 0 ? (
            <p className="text-sm text-emerald-700">✓ כל הסטודנטים מעל {data.atRiskThreshold}% נוכחות.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-slate-500">נוכחות מתחת ל-{data.atRiskThreshold}%, מהנמוכה לגבוהה</p>
              <ul className="divide-y divide-slate-100">
                {data.atRisk.map((s) => (
                  <li key={s.email} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="truncate">
                      {s.firstName} {s.lastName}
                    </span>
                    <span className={`shrink-0 tabular-nums ${s.percent < 50 ? 'text-red-700' : 'text-amber-700'}`}>
                      {s.attended}/{data.finishedSessionCount} ({s.percent}%)
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card
          title="שאלות והערות"
          action={
            <Link to={`/courses/${course.id}/feed/present`} className="text-sm text-indigo-700 hover:underline">
              מסך הקרנה
            </Link>
          }
        >
          <Link to={`/courses/${course.id}/feed`} className="block rounded-lg p-1 hover:bg-slate-50">
            <span className="text-3xl font-bold tabular-nums">{data.feed.openQuestions}</span>
            <span className="ms-2 text-sm text-slate-600">שאלות פתוחות</span>
            <span className="mt-1 block text-xs text-slate-500">
              {data.feed.totalPosts} הודעות בסך הכל · לפיד ←
            </span>
          </Link>
        </Card>

        <Card title="מטלות">
          <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
            <p className="font-medium text-slate-600">בקרוב</p>
            <p className="mt-1 text-sm text-slate-500">כאן יופיעו המטלות של הקורס ותאריכי ההגשה.</p>
          </div>
        </Card>
      </div>

      <Link
        to={`/courses/${course.id}/students`}
        className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
      >
        <span>
          <span className="font-semibold">רשימת הסטודנטים</span>
          <span className="ms-2 text-sm text-slate-500">נוכחות, הרשמה ופעילות אחרונה לכל סטודנט</span>
        </span>
        <span className="text-slate-400">←</span>
      </Link>
    </div>
  );
}
