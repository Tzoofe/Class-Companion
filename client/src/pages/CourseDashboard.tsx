import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadFile, type CourseDashboard as Dashboard } from '../api';
import { Bento, TextLink, Tile } from '../components/Bento';
import DotGrid, { DotLegend } from '../components/DotGrid';
import { BackLink, ErrorBox, ghostButton, pillButton } from '../components/ui';

const LIVE_POLL_MS = 5000;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
const longDate = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Present-per-session bars (one series, so no legend). Hover/focus a bar for its exact numbers. */
function AttendanceChart({ courseId, history, rosterCount }: { courseId: string; history: Dashboard['history']; rosterCount: number }) {
  if (history.length === 0) return <p className="py-6 text-center text-sm text-ink-3">עוד לא התקיימו מפגשים.</p>;
  const max = Math.max(rosterCount, 1);
  const first = history[0];
  const last = history[history.length - 1];

  return (
    <figure>
      <div className="flex items-baseline justify-between text-xs text-ink-4">
        <span>{rosterCount} סטודנטים</span>
      </div>
      <div
        className="mt-1 flex h-36 items-end gap-[2px] border-b border-line-strong"
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
                className="w-full rounded-t-[4px] bg-accent transition-colors group-hover:bg-accent-strong group-focus-visible:bg-accent-strong"
                style={{ height: `${Math.max(pct, s.present > 0 ? 2 : 0)}%` }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-elevated px-2 py-1 text-xs text-ink shadow ring-1 ring-line group-hover:block group-focus-visible:block">
                <div>{longDate(s.startsAt)}</div>
                <div className="font-semibold tabular-nums">
                  {s.present}/{rosterCount} · {pct}%
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      <figcaption className="mt-1 flex justify-between text-xs text-ink-3" dir="ltr">
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
  const menu = useRef<HTMLDetailsElement>(null);

  // Close the "עוד" menu on a click outside it or on Escape.
  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      const el = menu.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

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
        <Link to="/courses" className="text-sm text-accent-ink underline">
          חזרה לקורסים
        </Link>
      </div>
    ) : (
      <p className="text-ink-3">טוען…</p>
    );

  const { course, rosterCount } = data;
  const shown = data.live ?? data.lastSession;
  const avgCount = data.averagePercent === null ? null : Math.round((data.averagePercent / 100) * rosterCount);
  const poll = data.polls.open;
  const menuLink = 'block rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink';

  return (
    <div className="space-y-6">
      <div>
        <BackLink to="/courses">הקורסים שלי</BackLink>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl">{course.name}</h1>
          <div className="flex items-center gap-2">
            <Link to={`/courses/${course.id}/attendance`} className={data.live ? 'rounded-full bg-good-strong px-4 py-2 text-sm font-medium text-white' : pillButton}>
              {data.live ? 'למפגש הפעיל' : 'התחלת נוכחות'}
            </Link>
            <Link to={`/courses/${course.id}/summaries`} className={ghostButton}>
              העלאת הקלטה
            </Link>
            <button type="button" onClick={exportFile} disabled={exporting} className={ghostButton}>
              {exporting ? '…' : 'ייצוא'}
            </button>
            <details ref={menu} className="relative">
              <summary className={`${ghostButton} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} aria-label="עוד">
                עוד
              </summary>
              <div className="absolute end-0 z-20 mt-2 w-52 rounded-2xl bg-elevated p-1.5 shadow-lg ring-1 ring-line">
                <Link to={`/courses/${course.id}/students`} className={menuLink}>רשימת הסטודנטים</Link>
                <Link to={`/courses/${course.id}/sessions`} className={menuLink}>כל המפגשים</Link>
                <Link to={`/courses/${course.id}/schedule`} className={menuLink}>לוח זמנים</Link>
                <Link to={`/courses/${course.id}/feed`} className={menuLink}>שאלות והערות</Link>
                <Link to={`/courses/${course.id}/polls`} className={menuLink}>סקרים</Link>
                <Link to={`/courses/${course.id}/summaries`} className={menuLink}>סיכומי שיעורים</Link>
                <Link to={`/courses/${course.id}/feed/present`} className={menuLink}>מסך הקרנה: שאלות</Link>
                <Link to={`/courses/${course.id}/polls/present`} className={menuLink}>מסך הקרנה: סקר</Link>
                <Link to={`/courses/${course.id}/settings`} className={menuLink}>הגדרות הקורס</Link>
              </div>
            </details>
          </div>
        </div>
      </div>

      <ErrorBox>{error}</ErrorBox>

      <Bento>
        {/* The class: live or last time. The one emphasized tile. */}
        <Tile
          size="wide"
          tone="hero"
          title={data.live ? 'נוכחות פתוחה עכשיו' : shown ? 'המפגש האחרון' : 'נוכחות'}
          action={
            data.live ? (
              <TextLink to={`/courses/${course.id}/attendance`}>למסך הנוכחות</TextLink>
            ) : data.lastSession ? (
              <TextLink to={`/courses/${course.id}/sessions/${data.lastSession.id}`}>{longDate(data.lastSession.startsAt)}</TextLink>
            ) : undefined
          }
        >
          <DotGrid present={shown?.present ?? 0} manual={shown?.manual ?? 0} total={rosterCount} size="lg" />
          <div className="mt-auto pt-6">
            {shown ? (
              <>
                <p className="font-display text-5xl leading-none tabular-nums">
                  {shown.present}
                  <span className="text-2xl text-ink-3"> מתוך {rosterCount} סטודנטים</span>
                </p>
                <p className="mt-2 text-sm text-ink-3">{data.live ? 'סימנו נוכחות עד עכשיו' : 'נכחו במפגש'}</p>
              </>
            ) : (
              <p className="text-ink-2">{rosterCount} סטודנטים בקורס. עוד לא התקיים מפגש.</p>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <DotLegend withManual={!!shown?.manual} />
              <span className="text-xs text-ink-3">
                {data.registeredCount} מתוך {rosterCount} נרשמו לאפליקציה
              </span>
            </div>
          </div>
        </Tile>

        <Tile size="wide" title="מגמה" action={data.sessionCount > 0 ? <TextLink to={`/courses/${course.id}/sessions`}>כל המפגשים</TextLink> : undefined}>
          {data.lastSession && avgCount !== null ? (
            <p className="mb-4 text-ink-2">
              במפגש האחרון נכחו <strong className="font-medium text-ink">{data.lastSession.present}</strong>, ובממוצע נוכחים{' '}
              <strong className="font-medium text-ink">{avgCount}</strong> ({data.averagePercent}%).
            </p>
          ) : null}
          <AttendanceChart courseId={course.id} history={data.history} rosterCount={rosterCount} />
        </Tile>

        <Tile size="wide" title="דורשים תשומת לב" action={<TextLink to={`/courses/${course.id}/students`}>כל הסטודנטים</TextLink>}>
          {!data.attendanceRequired ? (
            <p className="text-sm text-ink-3">
              הנוכחות בקורס הזה אינה חובה, ולכן אף סטודנט/ית לא מסומן/ת כאן.{' '}
              <TextLink to={`/courses/${course.id}/settings`}>שינוי בהגדרות</TextLink>
            </p>
          ) : data.finishedSessionCount === 0 ? (
            <p className="text-sm text-ink-3">יופיע אחרי המפגש הראשון.</p>
          ) : data.atRisk.length === 0 ? (
            <p className="text-sm text-ink-2">כל הסטודנטים מעל {data.atRiskThreshold}% נוכחות.</p>
          ) : (
            <>
              <ul className="divide-y divide-line">
                {data.atRisk.map((s) => (
                  <li key={s.email} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                    <span className="truncate">
                      {s.firstName} {s.lastName}
                    </span>
                    <span className="shrink-0 tabular-nums text-warn">
                      {s.attended} מתוך {data.finishedSessionCount} מפגשים
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-auto pt-3 text-xs text-ink-3">
                נוכחות מתחת ל-{data.atRiskThreshold}%{data.atRiskCount > data.atRisk.length ? `, ועוד ${data.atRiskCount - data.atRisk.length} ברשימה המלאה` : ''}.
              </p>
            </>
          )}
        </Tile>

        <Tile size="wide" title="פעילות בכיתה">
          <ul className="divide-y divide-line">
            <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="block">{poll ? 'סקר פתוח' : 'סקרים'}</span>
                <span className="block truncate text-ink-3">{poll ? poll.question : `${data.polls.total} סקרים עד עכשיו`}</span>
              </span>
              <TextLink to={`/courses/${course.id}/polls`}>{poll ? 'לתוצאות' : 'לסקרים'}</TextLink>
            </li>
            <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span>
                <span className="block">שאלות פתוחות</span>
                <span className="block text-ink-3">
                  {data.feed.openQuestions ? `${data.feed.openQuestions} מחכות לתשובה` : 'אין שאלות שמחכות לתשובה'}, {data.feed.totalPosts} הודעות בסך הכל
                </span>
              </span>
              <TextLink to={`/courses/${course.id}/feed`}>לשאלות</TextLink>
            </li>
          </ul>
        </Tile>
      </Bento>
    </div>
  );
}
