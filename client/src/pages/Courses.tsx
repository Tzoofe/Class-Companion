import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type Agenda, type AgendaItem, type LecturerOverview, type StudentCourse } from '../api';
import { useAuth } from '../auth';
import { KIND_HE, LinkButton, dayLabel, timing } from '../components/AgendaList';
import { Bento, Tile } from '../components/Bento';
import DotGrid, { DotLegend } from '../components/DotGrid';
import { IconAlert, IconBook, IconCalendar, IconCheck, IconPin, IconPoll, IconQuestion } from '../components/icons';
import NotificationsCard from '../components/NotificationsCard';
import { ErrorBox, ghostButton, pillButton } from '../components/ui';

const REFRESH_MS = 15_000;

/** Fetches on mount and every REFRESH_MS while the tab is visible. */
function useLive<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<T>(path).then(
        (d) => alive && (setData(d), setError('')),
        (e) => alive && setError(e.message),
      );
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [path]);
  return { data, error };
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
const clock = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
const isLesson = (i: AgendaItem) => !i.cancelled && (i.kind === 'class' || i.kind === 'extra');
const itemTitle = (i: AgendaItem) => (i.kind === 'class' ? i.title || KIND_HE.class : i.title || KIND_HE[i.kind]);

/** Small status chip with an icon; the text always says what it means. */
function Chip({ tone, icon, children }: { tone: 'accent' | 'good' | 'warn' | 'muted'; icon?: ReactNode; children: ReactNode }) {
  const cls = { accent: 'bg-accent-soft text-accent-ink', good: 'bg-good-soft text-good', warn: 'bg-warn-soft text-warn', muted: 'bg-surface-2 text-ink-3' }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs ${cls}`}>
      {icon}
      {children}
    </span>
  );
}

/** Compact list of agenda items for inside a tile (no nested cards). */
function AgendaRows({ items, agenda, action, showDay }: { items: AgendaItem[]; agenda: Agenda; action?: (i: AgendaItem) => ReactNode; showDay?: boolean }) {
  return (
    <ul className="-mx-1 divide-y divide-line">
      {items.map((i, n) => {
        const t = timing(i, agenda.now);
        return (
          <li key={`${i.courseId}-${i.slotId ?? i.eventId}-${i.date}-${n}`} className={`flex items-start gap-3 px-1 py-2.5 ${t === 'past' ? 'opacity-50' : ''}`}>
            <span className="w-12 shrink-0 pt-0.5 text-sm tabular-nums text-ink-2" dir="ltr">
              {i.start}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm ${i.cancelled ? 'text-ink-4 line-through' : ''}`}>{i.courseName}</span>
              <span className="block truncate text-xs text-ink-3">
                {showDay && `${dayLabel(i.date, agenda.now.date)}, `}
                {i.cancelled ? 'בוטל' : itemTitle(i)}
                {i.place && `, ${i.place}`}
              </span>
            </span>
            {t === 'now' && !i.cancelled && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-good" aria-label="עכשיו" />}
            {action?.(i)}
          </li>
        );
      })}
    </ul>
  );
}

// ───────────────────────── Lecturer ─────────────────────────

/** One thing waiting for the lecturer, linking to where it's handled. */
function ActionRow({ to, icon, title, detail, tone = 'muted' }: { to: string; icon: ReactNode; title: string; detail: string; tone?: 'muted' | 'accent' | 'warn' }) {
  const color = { muted: 'text-ink-3', accent: 'text-accent-ink', warn: 'text-warn' }[tone];
  return (
    <li>
      <Link to={to} className="flex items-start gap-3 rounded-lg px-1 py-2.5 transition-colors hover:bg-surface-2">
        <span className={`mt-0.5 shrink-0 ${color}`}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-sm">{title}</span>
          <span className="block truncate text-xs text-ink-3">{detail}</span>
        </span>
      </Link>
    </li>
  );
}

/** The hero tile: what's live, else the next lesson today, else the latest session. */
function NowTile({ overview, agenda }: { overview: LecturerOverview; agenda: Agenda | null }) {
  const live = overview.live.sessions[0];
  if (live) {
    return (
      <Tile size="lg" title={`נוכחות פתוחה עד ${clock(live.endsAt)}`} icon={<span className="block h-2 w-2 rounded-full bg-good motion-safe:animate-pulse" />} action={<Link to={`/courses/${live.courseId}/attendance`} className={pillButton}>למסך הנוכחות</Link>}>
        <h2 className="text-2xl">{live.courseName}</h2>
        <div className="mt-5">
          <DotGrid present={live.present} manual={live.manual} total={live.rosterCount} size="lg" />
        </div>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-5">
          <p className="font-display text-5xl leading-none tabular-nums">
            {live.present}
            <span className="text-2xl text-ink-3"> מתוך {live.rosterCount} סטודנטים</span>
            <span className="mt-2 block font-sans text-sm text-ink-3">סימנו נוכחות עד עכשיו</span>
          </p>
          <DotLegend withManual={live.manual > 0} />
        </div>
      </Tile>
    );
  }

  const next = agenda?.items.find((i) => i.date === agenda.now.date && isLesson(i) && timing(i, agenda.now) !== 'past');
  if (next && agenda) {
    const t = timing(next, agenda.now);
    return (
      <Tile size="lg" title={t === 'now' ? 'עכשיו' : t === 'soon' ? 'מתחיל בקרוב' : 'השיעור הבא היום'} icon={<IconCalendar />}>
        <p className="font-display text-6xl leading-none tabular-nums" dir="ltr">
          {next.start}
          {next.end && <span className="text-2xl text-ink-3">–{next.end}</span>}
        </p>
        <h2 className="mt-4 text-2xl">{next.courseName}</h2>
        <p className="mt-1 text-ink-2">
          {itemTitle(next)}
          {next.place && `, ${next.place}`}
        </p>
        <div className="mt-auto pt-6">
          <Link to={`/courses/${next.courseId}/attendance`} className={t === 'later' ? ghostButton : pillButton}>
            התחלת נוכחות
          </Link>
        </div>
      </Tile>
    );
  }

  const latest = [...overview.courses].filter((c) => c.lastSession).sort((a, b) => b.lastSession!.startsAt.localeCompare(a.lastSession!.startsAt))[0];
  if (latest?.lastSession) {
    const s = latest.lastSession;
    return (
      <Tile size="lg" title={`המפגש האחרון, ${shortDate(s.startsAt)}`} icon={<IconCheck />} to={`/courses/${latest.id}`}>
        <h2 className="text-2xl">{latest.name}</h2>
        <div className="mt-5">
          <DotGrid present={s.present} manual={s.manual} total={latest.rosterCount} size="lg" />
        </div>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-5">
          <p className="font-display text-5xl leading-none tabular-nums">
            {s.present}
            <span className="text-2xl text-ink-3"> מתוך {latest.rosterCount} סטודנטים</span>
            <span className="mt-2 block font-sans text-sm text-ink-3">נכחו במפגש</span>
          </p>
          <DotLegend withManual={s.manual > 0} />
        </div>
      </Tile>
    );
  }

  return (
    <Tile size="lg" title="מתחילים">
      <h2 className="text-2xl">{overview.courses.length ? 'עוד לא התקיים מפגש' : 'עדיין אין קורסים'}</h2>
      <p className="mt-2 text-ink-2">
        {overview.courses.length ? 'כשתפתחו נוכחות בשיעור, הכיתה תתמלא כאן בזמן אמת.' : 'צרו קורס מקובץ רשימת הסטודנטים, והסטודנטים יראו אותו אוטומטית.'}
      </p>
      <div className="mt-auto pt-6">
        <Link to="/courses/new" className={pillButton}>
          {overview.courses.length ? 'קורס חדש' : 'יצירת קורס'}
        </Link>
      </div>
    </Tile>
  );
}

function LecturerHome() {
  const { data: overview, error } = useLive<LecturerOverview>('/me/overview');
  const { data: agenda } = useLive<Agenda>('/me/agenda?days=7');

  if (!overview) return error ? <ErrorBox>{error}</ErrorBox> : <p className="text-ink-3">טוען…</p>;

  const liveCourses = new Set(overview.live.sessions.map((s) => s.courseId));
  const todayItems = agenda?.items.filter((i) => i.date === agenda.now.date) ?? [];
  const laterItems = agenda?.items.filter((i) => i.date > agenda.now.date && !i.cancelled) ?? [];
  const { questions, atRisk } = overview.attention;
  const polls = overview.live.polls;
  const nothingToDo = !questions.length && !atRisk.length && !polls.length;

  return (
    <div className="space-y-3">
      <h1 className="sr-only">דף הבית</h1>
      <ErrorBox>{error}</ErrorBox>
      <Bento>
        <NowTile overview={overview} agenda={agenda} />

        <Tile size="tall" title="היום" icon={<IconCalendar />}>
          {!agenda ? (
            <p className="text-sm text-ink-3">טוען…</p>
          ) : todayItems.length ? (
            <AgendaRows
              items={todayItems}
              agenda={agenda}
              action={(i) => {
                if (!isLesson(i)) return null;
                if (liveCourses.has(i.courseId)) return <LinkButton to={`/courses/${i.courseId}/attendance`} tone="live">פתוח</LinkButton>;
                const t = timing(i, agenda.now);
                return t === 'now' || t === 'soon' ? <LinkButton to={`/courses/${i.courseId}/attendance`}>התחלה</LinkButton> : null;
              }}
            />
          ) : agenda.hasSchedule ? (
            <div className="text-sm">
              <p className="text-ink-2">אין שיעורים היום.</p>
              {laterItems[0] && (
                <p className="mt-2 text-ink-3">
                  הבא: {laterItems[0].courseName}, {dayLabel(laterItems[0].date, agenda.now.date)} ב-{laterItems[0].start}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink-2">הוסיפו זמני שיעור בלוח הזמנים של כל קורס, והם יופיעו כאן.</p>
          )}
          {laterItems.length > 0 && todayItems.length > 0 && <p className="mt-auto pt-3 text-xs text-ink-3">עוד {laterItems.length} ב-7 הימים הקרובים</p>}
        </Tile>

        <Tile size="tall" title="דורש טיפול" icon={<IconAlert />}>
          {nothingToDo ? (
            <p className="text-sm text-ink-3">אין כרגע שום דבר שמחכה לך.</p>
          ) : (
            <ul className="-mx-1 divide-y divide-line">
              {questions.map((q) => (
                <ActionRow key={q.postId} to={`/courses/${q.courseId}/feed`} icon={<IconQuestion />} title={q.text} detail={`שאלה ללא מענה ב${q.courseName}${q.votes ? `, ${q.votes} 👍` : ''}`} />
              ))}
              {polls.map((p) => (
                <ActionRow key={p.pollId} to={`/courses/${p.courseId}/polls`} icon={<IconPoll />} tone="accent" title={p.question} detail={`סקר פתוח ב${p.courseName}, ${p.responses} ענו`} />
              ))}
              {atRisk.map((r) => (
                <ActionRow key={r.courseId} to={`/courses/${r.courseId}/students`} icon={<IconAlert />} tone="warn" title={`${r.count} סטודנטים מתחת ל-70% נוכחות`} detail={r.courseName} />
              ))}
            </ul>
          )}
        </Tile>

        {overview.courses.map((c) => {
          const shown = c.live ?? c.lastSession;
          return (
            <Tile key={c.id} size="item" title={`${c.rosterCount} סטודנטים`} icon={<IconBook />} to={`/courses/${c.id}`}>
              <h3 className="text-lg leading-snug">{c.name}</h3>
              <div className="mt-auto space-y-2 pt-4">
                {shown ? (
                  <>
                    <DotGrid present={shown.present} manual={shown.manual} total={c.rosterCount} size="sm" />
                    <p className="text-sm text-ink-2">
                      {c.live ? `סימנו נוכחות עכשיו: ${shown.present} מתוך ${c.rosterCount}` : `נכחו ${shown.present} מתוך ${c.rosterCount} במפגש האחרון`}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-ink-3">עוד לא התקיים מפגש.</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {!c.attendanceRequired && <Chip tone="muted">נוכחות רשות</Chip>}
                  {c.liveSession && <Chip tone="good">נוכחות פתוחה</Chip>}
                  {c.pollOpen && <Chip tone="accent" icon={<IconPoll />}>סקר פתוח</Chip>}
                </div>
              </div>
            </Tile>
          );
        })}

        <Link to="/courses/new" className="col-span-2 flex min-h-16 items-center lg:min-h-[9.5rem] justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong text-ink-3 transition-colors hover:border-accent hover:text-accent-ink lg:col-span-1">
          קורס חדש
        </Link>
      </Bento>
    </div>
  );
}

// ───────────────────────── Student ─────────────────────────

function StudentHome() {
  const { data, error } = useLive<{ courses: StudentCourse[] }>('/courses');
  const { data: agenda } = useLive<Agenda>('/me/agenda?days=7');
  const courses = data?.courses ?? null;

  const next = agenda?.items.find((i) => isLesson(i) && timing(i, agenda.now) !== 'past');
  const t = next && agenda ? timing(next, agenda.now) : null;
  const rest = agenda?.items.filter((i) => i !== next && timing(i, agenda.now) !== 'past') ?? [];

  return (
    <div className="space-y-3">
      <h1 className="sr-only">דף הבית</h1>
      <NotificationsCard />
      <ErrorBox>{error}</ErrorBox>
      {courses === null && !error && <p className="text-ink-3">טוען…</p>}

      {courses?.length === 0 && (
        <div className="card p-6 text-ink-2">אינך רשום/ה לאף קורס. אם זו טעות, בקשו מהמרצה להוסיף את המייל שלך לרשימת הקורס.</div>
      )}

      {courses && courses.length > 0 && (
        <Bento>
          {next && agenda ? (
            <Tile size="lg" title={t === 'now' ? 'עכשיו' : t === 'soon' ? 'מתחיל בקרוב' : `השיעור הבא, ${dayLabel(next.date, agenda.now.date)}`} icon={<IconCalendar />} tone={t === 'now' || t === 'soon' ? 'accent' : 'plain'}>
              <p className="font-display text-6xl leading-none tabular-nums" dir="ltr">
                {next.start}
                {next.end && <span className="text-2xl text-ink-3">–{next.end}</span>}
              </p>
              <h2 className="mt-4 text-2xl">{next.courseName}</h2>
              <p className="mt-1 flex items-center gap-1.5 text-ink-2">
                {itemTitle(next)}
                {next.place && (
                  <>
                    <IconPin className="text-ink-3" />
                    {next.place}
                  </>
                )}
              </p>
              {(t === 'now' || t === 'soon') && (
                <div className="mt-auto pt-6">
                  <Link to={`/courses/${next.courseId}/checkin`} className={`${pillButton} w-full py-3 text-base sm:w-auto`}>
                    סימון נוכחות
                  </Link>
                </div>
              )}
            </Tile>
          ) : (
            <Tile size="lg" title="השבוע" icon={<IconCalendar />}>
              <h2 className="text-2xl">{agenda?.hasSchedule ? 'אין שיעורים בשבוע הקרוב' : 'עוד אין מערכת שעות'}</h2>
              <p className="mt-2 text-ink-2">כשהמרצה יוסיף/תוסיף זמני שיעור, השיעור הבא יופיע כאן.</p>
            </Tile>
          )}

          {agenda?.hasSchedule && (
            <Tile size="tall" title="בהמשך השבוע" icon={<IconCalendar />}>
              {rest.length ? <AgendaRows items={rest.slice(0, 8)} agenda={agenda} showDay /> : <p className="text-sm text-ink-3">אין עוד שיעורים השבוע.</p>}
            </Tile>
          )}

          {courses.map((c) => (
            <Tile key={c.id} size="wide" title={c.lecturerName || 'קורס'} icon={<IconBook />}>
              <h3 className="text-xl">{c.name}</h3>
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                <Link to={`/courses/${c.id}/checkin`} className={pillButton}>
                  נוכחות
                </Link>
                <Link to={`/courses/${c.id}/feed`} className={ghostButton}>
                  שאלות
                </Link>
                <Link to={`/courses/${c.id}/polls`} className={ghostButton}>
                  סקרים
                </Link>
              </div>
            </Tile>
          ))}
        </Bento>
      )}
    </div>
  );
}

export default function Courses() {
  const { user } = useAuth();
  return user?.role === 'lecturer' ? <LecturerHome /> : <StudentHome />;
}
