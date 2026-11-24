import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type Agenda, type AgendaItem, type LecturerOverview, type LessonRecap, type StudentCourse } from '../api';
import { useAuth } from '../auth';
import { KIND_HE, LinkButton, dayLabel, timing } from '../components/AgendaList';
import { Bento, TextLink, Tile } from '../components/Bento';
import DotGrid, { DotLegend } from '../components/DotGrid';
import { IconPin } from '../components/icons';
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

/** Agenda as plain rows inside a tile. */
function AgendaRows({ items, agenda, action, showDay }: { items: AgendaItem[]; agenda: Agenda; action?: (i: AgendaItem) => ReactNode; showDay?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((i, n) => {
        const t = timing(i, agenda.now);
        return (
          <li key={`${i.courseId}-${i.slotId ?? i.eventId}-${i.date}-${n}`} className={`flex items-center gap-4 py-3 ${t === 'past' ? 'opacity-50' : ''}`}>
            <span className="w-24 shrink-0 text-sm tabular-nums text-ink-2" dir="ltr">
              {i.start}
              {i.end && <span className="text-ink-3">–{i.end}</span>}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate ${i.cancelled ? 'text-ink-4 line-through' : ''}`}>{i.courseName}</span>
              <span className="block truncate text-sm text-ink-3">
                {showDay && `${dayLabel(i.date, agenda.now.date)}, `}
                {i.cancelled ? 'בוטל' : itemTitle(i)}
                {i.place && `, ${i.place}`}
              </span>
            </span>
            {t === 'now' && !i.cancelled && <span className="shrink-0 text-sm text-good">עכשיו</span>}
            {action?.(i)}
          </li>
        );
      })}
    </ul>
  );
}

/** Big "X out of N students" with what it counts. */
function Count({ present, total, caption }: { present: number; total: number; caption: string }) {
  return (
    <>
      <p className="font-display text-5xl leading-none tabular-nums">
        {present}
        <span className="text-2xl text-ink-3"> מתוך {total} סטודנטים</span>
      </p>
      <p className="mt-2 text-sm text-ink-3">{caption}</p>
    </>
  );
}

// ───────────────────────── Lecturer ─────────────────────────

/** The next lesson (now, soon, later today, or a later day) with time, place and the start button. */
function NextLessonTile({ item, agenda }: { item: AgendaItem; agenda: Agenda }) {
  const t = timing(item, agenda.now);
  const title = t === 'now' ? 'עכשיו' : t === 'soon' ? 'מתחיל בקרוב' : item.date === agenda.now.date ? 'השיעור הבא, היום' : `השיעור הבא, ${dayLabel(item.date, agenda.now.date)}`;
  return (
    <Tile size="wide" tone="hero" title={title} action={<TextLink to={`/courses/${item.courseId}`}>לקורס</TextLink>}>
      <p className="font-display text-6xl leading-none tabular-nums" dir="ltr">
        {item.start}
        {item.end && <span className="text-2xl text-ink-3">–{item.end}</span>}
      </p>
      <p className="mt-4 text-2xl">{item.courseName}</p>
      <p className="mt-1 flex items-center gap-1.5 text-ink-2">
        {itemTitle(item)}
        {item.place && (
          <>
            <IconPin className="text-ink-3" />
            {item.place}
          </>
        )}
      </p>
      {item.date === agenda.now.date && (
        <div className="mt-auto pt-6">
          <Link to={`/courses/${item.courseId}/attendance`} className={t === 'now' || t === 'soon' ? pillButton : ghostButton}>
            התחלת נוכחות
          </Link>
        </div>
      )}
    </Tile>
  );
}

/** After a lesson (same day): who came, what was asked, how the polls went. */
function RecapTile({ recap }: { recap: LessonRecap }) {
  return (
    <Tile size="wide" tone="hero" title="סיכום השיעור" action={<TextLink to={`/courses/${recap.courseId}/sessions/${recap.sessionId}`}>לרשימת הנוכחות</TextLink>}>
      <p className="-mt-2 mb-4 text-ink-2">
        {recap.courseName}
        <span className="text-sm text-ink-3">, הסתיים ב-{clock(recap.endsAt)}</span>
      </p>
      <DotGrid present={recap.present} manual={recap.manual} total={recap.rosterCount} size="md" />
      <p className="mt-3">
        <span className="font-display text-3xl tabular-nums">{recap.present}</span>
        <span className="text-ink-3"> מתוך {recap.rosterCount} סטודנטים נכחו</span>
        {recap.manual > 0 && <span className="text-sm text-ink-3"> ({recap.manual} סומנו ידנית)</span>}
      </p>
      <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
        <li className="flex items-center justify-between gap-3 py-2.5">
          <span>
            {recap.questions ? `${recap.questions} שאלות נשאלו בשיעור` : 'לא נשאלו שאלות בשיעור'}
            {recap.unanswered > 0 && <span className="text-warn">, {recap.unanswered} עדיין ללא מענה</span>}
            {recap.suggestions > 0 && <span className="text-ink-3">, {recap.suggestions} הצעות</span>}
          </span>
          {recap.questions + recap.suggestions > 0 && <TextLink to={`/courses/${recap.courseId}/feed`}>לשאלות</TextLink>}
        </li>
        <li className="flex items-center justify-between gap-3 py-2.5">
          <span>
            {!recap.summary
              ? 'סיכום שיעור: אפשר להעלות את ההקלטה מזום'
              : recap.summary.status === 'published'
                ? 'סיכום השיעור פורסם לסטודנטים'
                : recap.summary.status === 'draft'
                  ? 'טיוטת סיכום מוכנה לבדיקה'
                  : recap.summary.status === 'failed'
                    ? 'יצירת הסיכום נכשלה'
                    : 'הסיכום בהכנה…'}
          </span>
          <TextLink to={recap.summary ? `/courses/${recap.courseId}/summaries/${recap.summary.id}` : `/courses/${recap.courseId}/summaries`}>
            {recap.summary ? 'לסיכום' : 'העלאה'}
          </TextLink>
        </li>
        {recap.polls.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="block truncate">סקר: {p.question}</span>
              <span className="block text-ink-3">
                {p.responses} ענו{p.top && `, ${p.top.percent !== null ? `${p.top.percent}% בחרו "${p.top.text}"` : p.top.text}`}
              </span>
            </span>
            <TextLink to={`/courses/${recap.courseId}/polls`}>לתוצאות</TextLink>
          </li>
        ))}
      </ul>
    </Tile>
  );
}

/** The main tile: live session, imminent lesson, today's recap, next lesson, or the latest session. */
function NowTile({ overview, agenda }: { overview: LecturerOverview; agenda: Agenda | null }) {
  const live = overview.live.sessions[0];
  if (live) {
    return (
      <Tile size="wide" tone="hero" title={live.courseName} action={<TextLink to={`/courses/${live.courseId}/attendance`}>למסך הנוכחות</TextLink>}>
        <p className="-mt-2 mb-4 text-sm text-good">נוכחות פתוחה עד {clock(live.endsAt)}</p>
        <DotGrid present={live.present} manual={live.manual} total={live.rosterCount} size="lg" />
        <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-6">
          <div>
            <Count present={live.present} total={live.rosterCount} caption="סימנו נוכחות עד עכשיו" />
          </div>
          <DotLegend withManual={live.manual > 0} />
        </div>
      </Tile>
    );
  }

  // A lesson happening now or starting within 30 minutes comes first: that's when you open attendance.
  const upcoming = agenda?.items.filter((i) => isLesson(i) && timing(i, agenda.now) !== 'past') ?? [];
  const imminent = upcoming.find((i) => {
    const t = timing(i, agenda!.now);
    return t === 'now' || t === 'soon';
  });
  if (imminent && agenda) return <NextLessonTile item={imminent} agenda={agenda} />;

  // Then, on the day of a lesson, its recap.
  const recap = overview.recap;
  if (recap) return <RecapTile recap={recap} />;

  // Otherwise the next lesson, today or later this week.
  if (upcoming[0] && agenda) return <NextLessonTile item={upcoming[0]} agenda={agenda} />;

  const latest = [...overview.courses].filter((c) => c.lastSession).sort((a, b) => b.lastSession!.startsAt.localeCompare(a.lastSession!.startsAt))[0];
  if (latest?.lastSession) {
    const s = latest.lastSession;
    return (
      <Tile size="wide" tone="hero" title={latest.name} action={<TextLink to={`/courses/${latest.id}`}>לקורס</TextLink>}>
        <p className="-mt-2 mb-4 text-sm text-ink-3">המפגש האחרון, {shortDate(s.startsAt)}</p>
        <DotGrid present={s.present} manual={s.manual} total={latest.rosterCount} size="lg" />
        <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-6">
          <div>
            <Count present={s.present} total={latest.rosterCount} caption="נכחו במפגש" />
          </div>
          <DotLegend withManual={s.manual > 0} />
        </div>
      </Tile>
    );
  }

  return (
    <Tile size="wide" tone="hero" title={overview.courses.length ? 'עוד לא התקיים מפגש' : 'עדיין אין קורסים'}>
      <p className="text-ink-2">
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

/** One thing waiting for the lecturer, linking to where it's handled. */
function ActionRow({ to, title, detail, warn }: { to: string; title: string; detail: string; warn?: boolean }) {
  return (
    <li>
      <Link to={to} className="flex items-center justify-between gap-3 py-3">
        <span className="min-w-0">
          <span className="line-clamp-2 block">{title}</span>
          <span className={`block truncate text-sm ${warn ? 'text-warn' : 'text-ink-3'}`}>{detail}</span>
        </span>
        <span className="shrink-0 text-sm text-ink-3 underline decoration-line-strong underline-offset-4">פתיחה</span>
      </Link>
    </li>
  );
}

function LecturerHome() {
  const { data: overview, error } = useLive<LecturerOverview>('/me/overview');
  const { data: agenda } = useLive<Agenda>('/me/agenda?days=7');

  if (!overview) return error ? <ErrorBox>{error}</ErrorBox> : <p className="text-ink-3">טוען…</p>;

  const liveCourses = new Set(overview.live.sessions.map((s) => s.courseId));
  const todayItems = agenda?.items.filter((i) => i.date === agenda.now.date) ?? [];
  const laterItems = agenda?.items.filter((i) => i.date > agenda.now.date && !i.cancelled) ?? [];
  const { questions, atRisk, toGrade } = overview.attention;
  const polls = overview.live.polls;
  const nothingToDo = !questions.length && !atRisk.length && !polls.length && !toGrade.length;

  return (
    <div className="space-y-6">
      <h1 className="sr-only">דף הבית</h1>
      <ErrorBox>{error}</ErrorBox>
      <Bento>
        <NowTile overview={overview} agenda={agenda} />

        <Tile size="wide" title="היום" action={laterItems.length > 0 ? <span>עוד {laterItems.length} השבוע</span> : undefined}>
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
                return t === 'now' || t === 'soon' ? <LinkButton to={`/courses/${i.courseId}/attendance`}>התחלת נוכחות</LinkButton> : null;
              }}
            />
          ) : agenda.hasSchedule ? (
            <div>
              <p className="text-ink-2">אין שיעורים היום.</p>
              {laterItems[0] && (
                <p className="mt-2 text-sm text-ink-3">
                  הבא: {laterItems[0].courseName}, {dayLabel(laterItems[0].date, agenda.now.date)} ב-{laterItems[0].start}
                </p>
              )}
            </div>
          ) : (
            <p className="text-ink-2">עוד לא הוגדרו זמני שיעור. הוסיפו אותם בלוח הזמנים של כל קורס, והם יופיעו כאן.</p>
          )}
        </Tile>

        <Tile size="wide" title="דורש טיפול">
          {nothingToDo ? (
            <p className="text-ink-2">אין כרגע שום דבר שמחכה לך.</p>
          ) : (
            <ul className="divide-y divide-line">
              {questions.map((q) => (
                <ActionRow key={q.postId} to={`/courses/${q.courseId}/feed`} title={q.text} detail={`שאלה ללא מענה ב${q.courseName}${q.votes ? `, ${q.votes} 👍` : ''}`} />
              ))}
              {polls.map((p) => (
                <ActionRow key={p.pollId} to={`/courses/${p.courseId}/polls`} title={p.question} detail={`סקר פתוח ב${p.courseName}, ${p.responses} ענו`} />
              ))}
              {toGrade.map((t) => (
                <ActionRow key={t.assignmentId} to={`/courses/${t.courseId}/assignments/${t.assignmentId}`} title={`${t.count} הגשות ממתינות לציון`} detail={`${t.title}, ${t.courseName}`} />
              ))}
              {atRisk.map((r) => (
                <ActionRow key={r.courseId} to={`/courses/${r.courseId}/students`} title={`${r.count} סטודנטים מתחת ל-70% נוכחות`} detail={r.courseName} warn />
              ))}
            </ul>
          )}
        </Tile>

        <Tile size="wide" title="הקורסים שלי" action={<TextLink to="/courses/new">קורס חדש</TextLink>}>
          {overview.courses.length === 0 ? (
            <p className="text-ink-2">עדיין אין קורסים.</p>
          ) : (
            <ul className="divide-y divide-line">
              {overview.courses.map((c) => {
                const shown = c.live ?? c.lastSession;
                return (
                  <li key={c.id}>
                    <Link to={`/courses/${c.id}`} className="block space-y-2 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-lg">{c.name}</span>
                        <span className="shrink-0 text-sm text-ink-3">
                          {c.liveSession ? <span className="text-good">נוכחות פתוחה</span> : !c.attendanceRequired ? 'נוכחות רשות' : `${c.rosterCount} סטודנטים`}
                        </span>
                      </div>
                      {shown ? (
                        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                          <DotGrid present={shown.present} manual={shown.manual} total={c.rosterCount} size="sm" />
                          <span className="text-sm text-ink-3">
                            {c.live ? `${shown.present} מתוך ${c.rosterCount} סימנו נוכחות` : `${shown.present} מתוך ${c.rosterCount} נכחו במפגש האחרון`}
                          </span>
                        </div>
                      ) : (
                        <p className="text-sm text-ink-3">עוד לא התקיים מפגש.</p>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Tile>
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
    <div className="space-y-6">
      <h1 className="sr-only">דף הבית</h1>
      <NotificationsCard />
      <ErrorBox>{error}</ErrorBox>
      {courses === null && !error && <p className="text-ink-3">טוען…</p>}

      {courses?.length === 0 && <div className="tile p-6 text-ink-2">אינך רשום/ה לאף קורס. אם זו טעות, בקשו מהמרצה להוסיף את המייל שלך לרשימת הקורס.</div>}

      {courses && courses.length > 0 && (
        <Bento>
          {next && agenda ? (
            <Tile size="wide" tone="hero" title={t === 'now' ? 'עכשיו' : t === 'soon' ? 'מתחיל בקרוב' : `השיעור הבא, ${dayLabel(next.date, agenda.now.date)}`}>
              <p className="font-display text-6xl leading-none tabular-nums" dir="ltr">
                {next.start}
                {next.end && <span className="text-2xl text-ink-3">–{next.end}</span>}
              </p>
              <p className="mt-4 text-2xl">{next.courseName}</p>
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
            <Tile size="wide" tone="hero" title={agenda?.hasSchedule ? 'אין שיעורים בשבוע הקרוב' : 'עוד אין מערכת שעות'}>
              <p className="text-ink-2">כשהמרצה יוסיף/תוסיף זמני שיעור, השיעור הבא יופיע כאן.</p>
            </Tile>
          )}

          <Tile size="wide" title="בהמשך השבוע">
            {agenda?.hasSchedule && rest.length ? <AgendaRows items={rest.slice(0, 8)} agenda={agenda} showDay /> : <p className="text-ink-2">אין עוד שיעורים השבוע.</p>}
          </Tile>

          <Tile size="full" title="הקורסים שלי">
            <ul className="divide-y divide-line">
              {courses.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-lg">{c.name}</span>
                    {c.lecturerName && <span className="block text-sm text-ink-3">{c.lecturerName}</span>}
                  </span>
                  <span className="flex gap-2">
                    <Link to={`/courses/${c.id}/checkin`} className={pillButton}>
                      נוכחות
                    </Link>
                    <Link to={`/courses/${c.id}/feed`} className={ghostButton}>
                      שאלות
                    </Link>
                    <Link to={`/courses/${c.id}/polls`} className={ghostButton}>
                      סקרים
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </Tile>
        </Bento>
      )}
    </div>
  );
}

export default function Courses() {
  const { user } = useAuth();
  return user?.role === 'lecturer' ? <LecturerHome /> : <StudentHome />;
}
