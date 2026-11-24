import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type Agenda, type LecturerOverview, type StudentCourse } from '../api';
import { useAuth } from '../auth';
import AgendaList, { LinkButton, timing } from '../components/AgendaList';
import NotificationsCard from '../components/NotificationsCard';
import { ErrorBox } from '../components/ui';

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

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

/** Attendance % over the last sessions: one series, no axes; the last point is marked. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 96;
  const h = 28;
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 2 - (v / 100) * (h - 4);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const last = values[values.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`נוכחות ב-${values.length} המפגשים האחרונים: ${values.join('%, ')}%`} className="shrink-0">
      <polyline points={points} fill="none" className="stroke-indigo-500" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={3} className="fill-indigo-600 stroke-white" strokeWidth={1.5} />
    </svg>
  );
}

const shortWhen = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });

// ───────────────────────── Lecturer ─────────────────────────

function LecturerHome() {
  const { user } = useAuth();
  const { data: overview, error } = useLive<LecturerOverview>('/me/overview');
  const { data: agenda } = useLive<Agenda>('/me/agenda?days=7');

  const live = overview?.live;
  const liveCourses = new Set(live?.sessions.map((s) => s.courseId));
  const today = agenda ? { ...agenda, items: agenda.items.filter((i) => i.date === agenda.now.date) } : null;
  const later = agenda?.items.filter((i) => i.date > agenda.now.date && !i.cancelled) ?? [];
  const tomorrow = agenda ? later.filter((i) => i.date === nextDate(agenda.now.date)).length : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">שלום{user?.firstName ? `, ${user.firstName}` : ''}</h1>
        <Link to="/courses/new" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          + קורס חדש
        </Link>
      </div>
      <ErrorBox>{error}</ErrorBox>

      {/* Happening now */}
      {live && (live.sessions.length > 0 || live.polls.length > 0) && (
        <div className="space-y-2">
          {live.sessions.map((s) => (
            <Link key={s.sessionId} to={`/courses/${s.courseId}/attendance`} className="flex items-center justify-between gap-3 rounded-xl bg-emerald-600 p-4 text-white shadow-sm hover:bg-emerald-700">
              <span>
                <span className="block text-xs text-emerald-100">● נוכחות פתוחה</span>
                <span className="font-medium">{s.courseName}</span>
              </span>
              <span className="text-lg font-bold tabular-nums">
                {s.present}/{s.rosterCount}
              </span>
            </Link>
          ))}
          {live.polls.map((p) => (
            <Link key={p.pollId} to={`/courses/${p.courseId}/polls`} className="flex items-center justify-between gap-3 rounded-xl bg-indigo-600 p-4 text-white shadow-sm hover:bg-indigo-700">
              <span className="min-w-0">
                <span className="block text-xs text-indigo-200">📊 סקר פתוח · {p.courseName}</span>
                <span className="block truncate font-medium">{p.question}</span>
              </span>
              <span className="shrink-0 text-sm tabular-nums">{p.responses} ענו</span>
            </Link>
          ))}
        </div>
      )}

      {/* Today */}
      <Section title="היום">
        {today && (
          <AgendaList
            agenda={today}
            action={(item) => {
              if (item.kind !== 'class' && item.kind !== 'extra') return null;
              if (item.cancelled) return null;
              const t = timing(item, today.now);
              if (liveCourses.has(item.courseId))
                return (
                  <LinkButton to={`/courses/${item.courseId}/attendance`} tone="live">
                    ● למפגש
                  </LinkButton>
                );
              if (t === 'now' || t === 'soon') return <LinkButton to={`/courses/${item.courseId}/attendance`}>התחל נוכחות</LinkButton>;
              return null;
            }}
            empty={
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
                {agenda?.hasSchedule ? (
                  <>אין שיעורים היום.{later[0] && ` הבא: ${later[0].courseName}, ${later[0].date === nextDate(agenda.now.date) ? 'מחר' : shortWhen(later[0].date)} ב-${later[0].start}.`}</>
                ) : (
                  <>עוד לא הוגדרו זמני שיעורים. היכנסו לקורס ← "לוח זמנים" כדי להוסיף את השיעורים השבועיים, ואז הם יופיעו כאן.</>
                )}
              </div>
            }
          />
        )}
        {agenda && agenda.items.length > 0 && (
          <p className="text-xs text-slate-500">
            מחר: {tomorrow} · ב-7 הימים הקרובים: {later.length}
          </p>
        )}
      </Section>

      {/* Summary */}
      {overview && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="קורסים" value={overview.totals.courses} />
          <Tile label="סטודנטים" value={overview.totals.students} />
          <Tile label="נוכחות השבוע" value={overview.totals.weekAttendancePercent === null ? '—' : `${overview.totals.weekAttendancePercent}%`} />
          <Tile label="שאלות פתוחות" value={overview.totals.openQuestions} />
        </div>
      )}

      {/* Needs attention */}
      {overview && (overview.attention.questions.length > 0 || overview.attention.atRisk.length > 0) && (
        <Section title="דורש תשומת לב">
          <div className="grid gap-3 sm:grid-cols-2">
            {overview.attention.questions.length > 0 && (
              <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <h3 className="mb-2 text-sm font-semibold text-slate-700">❓ שאלות פתוחות מובילות</h3>
                <ul className="divide-y divide-slate-100">
                  {overview.attention.questions.map((q) => (
                    <li key={q.postId}>
                      <Link to={`/courses/${q.courseId}/feed`} className="flex items-start justify-between gap-3 py-2 hover:bg-slate-50">
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{q.text}</span>
                          <span className="text-xs text-slate-500">{q.courseName}</span>
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-slate-500">👍 {q.votes}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {overview.attention.atRisk.length > 0 && (
              <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <h3 className="mb-2 text-sm font-semibold text-slate-700">⚠ נוכחות נמוכה (מתחת ל-70%)</h3>
                <ul className="divide-y divide-slate-100">
                  {overview.attention.atRisk.map((r) => (
                    <li key={r.courseId}>
                      <Link to={`/courses/${r.courseId}/students`} className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-slate-50">
                        <span>{r.courseName}</span>
                        <span className="text-amber-700">{r.count} סטודנטים ←</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Courses */}
      <Section title="הקורסים שלי">
        {overview && overview.courses.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">עדיין אין קורסים. צרו קורס חדש עם רשימת הסטודנטים.</div>
        )}
        {!overview && !error && <p className="text-slate-500">טוען…</p>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {overview?.courses.map((c) => (
            <li key={c.id}>
              <Link to={`/courses/${c.id}`} className="block h-full rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:ring-indigo-300">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{c.name}</h3>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {c.rosterCount} סטודנטים · {c.sessionCount} מפגשים
                    </p>
                  </div>
                  <Sparkline values={c.trend} />
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span>
                    נוכחות ממוצעת: <strong className="tabular-nums">{c.averagePercent === null ? '—' : `${c.averagePercent}%`}</strong>
                  </span>
                  {c.lastSession && (
                    <span className="text-slate-600">
                      אחרון ({shortWhen(c.lastSession.startsAt)}): <span className="tabular-nums">{c.lastSession.present}/{c.rosterCount}</span>
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {c.liveSession && <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">● נוכחות פתוחה</span>}
                  {c.pollOpen && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700">📊 סקר פתוח</span>}
                  {c.openQuestions > 0 && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">❓ {c.openQuestions} שאלות</span>}
                  {c.atRiskCount > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">⚠ {c.atRiskCount} בנוכחות נמוכה</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function nextDate(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ───────────────────────── Student ─────────────────────────

function StudentHome() {
  const { data, error } = useLive<{ courses: StudentCourse[] }>('/courses');
  const { data: agenda } = useLive<Agenda>('/me/agenda?days=7');
  const courses = data?.courses ?? null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">הקורסים שלי</h1>
      <NotificationsCard />
      <ErrorBox>{error}</ErrorBox>

      {agenda && agenda.hasSchedule && (
        <Section title="השבוע">
          <AgendaList
            agenda={agenda}
            action={(item) => {
              if (item.cancelled || (item.kind !== 'class' && item.kind !== 'extra')) return null;
              const t = timing(item, agenda.now);
              return t === 'now' || t === 'soon' ? <LinkButton to={`/courses/${item.courseId}/checkin`}>סימון נוכחות</LinkButton> : null;
            }}
            empty={<div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">אין שיעורים ב-7 הימים הקרובים.</div>}
          />
        </Section>
      )}

      <Section title={agenda?.hasSchedule ? 'קורסים' : ''}>
        {courses === null && !error && <p className="text-slate-500">טוען…</p>}
        {courses?.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
            אינך רשום/ה לאף קורס. אם זו טעות, פנו למרצה כדי שיוסיף את האימייל שלך.
          </div>
        )}
        <ul className="grid gap-3 sm:grid-cols-2">
          {courses?.map((c) => (
            <li key={c.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h3 className="font-semibold">{c.name}</h3>
              {c.lecturerName && <p className="mt-1 text-sm text-slate-500">מרצה: {c.lecturerName}</p>}
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm font-medium">
                <Link to={`/courses/${c.id}/checkin`} className="rounded-lg bg-indigo-600 px-2 py-2 text-center text-white hover:bg-indigo-700">
                  נוכחות
                </Link>
                <Link to={`/courses/${c.id}/feed`} className="rounded-lg bg-white px-2 py-2 text-center text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50">
                  שאלות
                </Link>
                <Link to={`/courses/${c.id}/polls`} className="rounded-lg bg-white px-2 py-2 text-center text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50">
                  סקרים
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

export default function Courses() {
  const { user } = useAuth();
  return user?.role === 'lecturer' ? <LecturerHome /> : <StudentHome />;
}
