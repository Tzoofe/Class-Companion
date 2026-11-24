import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadFile, type CourseDashboard as Dashboard } from '../api';
import { Bento, Figure, Tile } from '../components/Bento';
import DotGrid, { DotLegend } from '../components/DotGrid';
import { IconAlert, IconBook, IconCalendar, IconChart, IconCheck, IconPoll, IconQuestion, IconSettings, IconUsers } from '../components/icons';
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

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between gap-3 text-sm">
          <BackLink to="/courses">הקורסים שלי</BackLink>
          <span className="flex gap-4">
            <Link to={`/courses/${course.id}/schedule`} className="inline-flex items-center gap-1.5 text-accent-ink hover:underline">
              <IconCalendar />
              לוח זמנים
            </Link>
            <Link to={`/courses/${course.id}/settings`} className="inline-flex items-center gap-1.5 text-accent-ink hover:underline">
              <IconSettings />
              הגדרות
            </Link>
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl">{course.name}</h1>
          <div className="flex gap-2">
            <button type="button" onClick={exportFile} disabled={exporting} className={ghostButton}>
              {exporting ? '…' : 'ייצוא'}
            </button>
            <Link to={`/courses/${course.id}/attendance`} className={data.live ? 'rounded-full bg-good-strong px-4 py-2 text-sm font-medium text-white' : pillButton}>
              {data.live ? 'למפגש הפעיל' : 'התחלת נוכחות'}
            </Link>
          </div>
        </div>
      </div>

      <ErrorBox>{error}</ErrorBox>

      <Bento>
        {/* Hero: the class, live or last time */}
        <Tile
          size="lg"
          title={data.live ? 'נוכחות פתוחה עכשיו' : shown ? `המפגש האחרון, ${longDate(data.lastSession!.startsAt)}` : 'נוכחות'}
          icon={data.live ? <span className="block h-2 w-2 rounded-full bg-good motion-safe:animate-pulse" /> : <IconCheck />}
          to={data.live ? `/courses/${course.id}/attendance` : data.lastSession ? `/courses/${course.id}/sessions/${data.lastSession.id}` : undefined}
        >
          {shown ? (
            <>
              <DotGrid present={shown.present} manual={shown.manual} total={rosterCount} size="lg" />
              <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-6">
                <p className="font-display text-5xl leading-none tabular-nums">
                  {shown.present}
                  <span className="text-2xl text-ink-3"> מתוך {rosterCount} סטודנטים</span>
            <span className="mt-2 block font-sans text-sm text-ink-3">{data.live ? 'סימנו נוכחות עד עכשיו' : 'נכחו במפגש'}</span>
                </p>
                <DotLegend withManual={shown.manual > 0} />
              </div>
            </>
          ) : (
            <>
              <DotGrid present={0} total={rosterCount} size="lg" label={`${rosterCount} סטודנטים, עוד לא התקיים מפגש`} />
              <p className="mt-auto pt-6 text-ink-2">עוד לא התקיים מפגש. כשתפתחו נוכחות, הכיתה תתמלא כאן.</p>
            </>
          )}
        </Tile>

        <Tile size="sm" title="סטודנטים" icon={<IconUsers />} to={`/courses/${course.id}/students`}>
          <Figure value={rosterCount} caption={`${data.registeredCount} נרשמו לאפליקציה`} />
        </Tile>
        <Tile size="sm" title="מפגש אחרון מול הממוצע" icon={<IconCheck />}>
          {data.lastSession && data.averagePercent !== null ? (
            <Figure
              value={data.lastSession.present}
              caption={`נכחו במפגש האחרון. בממוצע נוכחים ${Math.round((data.averagePercent / 100) * rosterCount)} (${data.averagePercent}%).`}
            />
          ) : (
            <p className="mt-auto text-sm text-ink-3">יופיע אחרי המפגש הראשון.</p>
          )}
        </Tile>
        <Tile size="sm" title="שאלות פתוחות" icon={<IconQuestion />} to={`/courses/${course.id}/feed`}>
          <Figure value={data.feed.openQuestions} caption={`${data.feed.totalPosts} הודעות בסך הכל`} />
        </Tile>
        <Tile size="sm" title={data.polls.open ? 'סקר פתוח' : 'סקרים'} icon={<IconPoll />} to={`/courses/${course.id}/polls`} tone={data.polls.open ? 'accent' : 'plain'}>
          {data.polls.open ? <p className="line-clamp-3 text-sm text-ink-2">{data.polls.open.question}</p> : <Figure value={data.polls.total} caption="סקרים בסך הכל" />}
        </Tile>

        <Tile
          size="wide"
          title="נוכחות לפי מפגש"
          icon={<IconChart />}
          action={
            data.sessionCount > 0 && (
              <Link to={`/courses/${course.id}/sessions`} className="text-accent-ink hover:underline">
                כל המפגשים
              </Link>
            )
          }
        >
          <AttendanceChart courseId={course.id} history={data.history} rosterCount={rosterCount} />
        </Tile>

        <Tile
          size="tall"
          title="דורשים תשומת לב"
          icon={<IconAlert />}
          action={
            <Link to={`/courses/${course.id}/students`} className="text-accent-ink hover:underline">
              כולם
            </Link>
          }
        >
          {!data.attendanceRequired ? (
            <p className="text-sm text-ink-3">
              הנוכחות בקורס הזה אינה חובה, ולכן אף סטודנט/ית לא מסומן/ת כאן.{' '}
              <Link to={`/courses/${course.id}/settings`} className="text-accent-ink underline">
                שינוי בהגדרות
              </Link>
            </p>
          ) : data.finishedSessionCount === 0 ? (
            <p className="text-sm text-ink-3">יופיע אחרי המפגש הראשון.</p>
          ) : data.atRisk.length === 0 ? (
            <p className="text-sm text-good">כל הסטודנטים מעל {data.atRiskThreshold}% נוכחות.</p>
          ) : (
            <>
              <p className="mb-1 text-xs text-ink-3">מתחת ל-{data.atRiskThreshold}%, מהנמוכה לגבוהה</p>
              <ul className="-mx-1 divide-y divide-line">
                {data.atRisk.map((s) => (
                  <li key={s.email} className="flex items-center justify-between gap-2 px-1 py-2 text-sm">
                    <span className="truncate">
                      {s.firstName} {s.lastName}
                    </span>
                    <span className={`shrink-0 tabular-nums ${s.percent < 50 ? 'text-bad' : 'text-warn'}`}>{s.percent}%</span>
                  </li>
                ))}
              </ul>
              {data.atRiskCount > data.atRisk.length && <p className="mt-auto pt-2 text-xs text-ink-3">ועוד {data.atRiskCount - data.atRisk.length}</p>}
            </>
          )}
        </Tile>

        <Tile size="sm" title="נוכחות" icon={<IconSettings />} to={`/courses/${course.id}/settings`}>
          <Figure value={data.attendanceRequired ? 'חובה' : 'רשות'} caption={`${data.sessionCount} מפגשים`} />
        </Tile>
        <Tile size="wide" title="מסכי הקרנה" icon={<IconPoll />}>
          <div className="mt-auto flex flex-wrap gap-2">
            <Link to={`/courses/${course.id}/feed/present`} className={ghostButton}>
              שאלות פתוחות
            </Link>
            <Link to={`/courses/${course.id}/polls/present`} className={ghostButton}>
              תוצאות סקר
            </Link>
          </div>
        </Tile>
        <Tile size="sm" title="מטלות" icon={<IconBook />}>
          <p className="mt-auto text-sm text-ink-3">בקרוב: מטלות ותאריכי הגשה.</p>
        </Tile>
      </Bento>
    </div>
  );
}
