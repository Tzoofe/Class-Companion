import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type CourseStudents, type StudentRow } from '../api';
import { ErrorBox, BackLink } from '../components/ui';

const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function percentClass(p: number | null) {
  if (p === null) return 'text-ink-4';
  if (p >= 80) return 'text-good';
  if (p >= 50) return 'text-warn';
  return 'text-bad';
}

function Attendance({ s }: { s: StudentRow }) {
  return (
    <span className={percentClass(s.percent)}>
      {s.attended}/{s.totalSessions} {s.percent !== null && <span className="text-xs">({s.percent}%)</span>}
    </span>
  );
}

function AccountBadge({ registered }: { registered: boolean }) {
  return registered ? (
    <span className="rounded-full bg-good-soft px-2 py-0.5 text-xs text-good">רשום/ה</span>
  ) : (
    <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs text-warn">לא נרשם/ה</span>
  );
}

function PresentNow({ value }: { value: boolean | null }) {
  if (value === null) return null;
  return value ? <span className="font-medium text-good">✓ נוכח/ת</span> : <span className="text-ink-4">— עדיין לא</span>;
}

export default function CourseStudents() {
  const { id } = useParams();
  const [data, setData] = useState<CourseStudents | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    api<CourseStudents>(`/courses/${id}/students`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  const students = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!data || !q) return data?.students ?? [];
    return data.students.filter((s) => `${s.firstName} ${s.lastName} ${s.lastName} ${s.firstName} ${s.email}`.toLowerCase().includes(q));
  }, [data, query]);

  if (error)
    return (
      <div className="space-y-3">
        <ErrorBox>{error}</ErrorBox>
        <Link to={`/courses/${id}`} className="text-sm text-accent-ink underline">
          חזרה לקורס
        </Link>
      </div>
    );
  if (!data) return <p className="text-ink-3">טוען…</p>;

  const { course } = data;
  const live = course.activeSessionId !== null;

  return (
    <div className="space-y-4">
      <div>
        <BackLink to={`/courses/${course.id}`}>{course.name}</BackLink>
        <h1 className="mt-1 text-xl">סטודנטים</h1>
        <p className="text-sm text-ink-3">
          {course.rosterCount} ברשימה · {course.registeredCount} נרשמו לאפליקציה · {course.sessionCount} מפגשים
        </p>
      </div>

      {live && (
        <p className="rounded-xl bg-good-soft p-3 text-sm text-good">
          מפגש נוכחות פעיל — {data.students.filter((s) => s.presentNow).length} נוכחים כרגע
        </p>
      )}

      <input
        type="search"
        placeholder="חיפוש לפי שם או אימייל"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-xl border border-line-strong bg-surface-2 px-3 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      />

      {students.length === 0 && <p className="py-6 text-center text-ink-3">לא נמצאו סטודנטים</p>}

      {/* Phones: cards */}
      <ul className="space-y-2 sm:hidden">
        {students.map((s) => (
          <li key={s.email} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">
                  {s.lastName} {s.firstName}
                </div>
                <div className="truncate text-xs text-ink-3" dir="ltr">
                  {s.email}
                </div>
              </div>
              <AccountBadge registered={s.registered} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span>
                נוכחות: <Attendance s={s} />
              </span>
              <span className="text-ink-3">נראה לאחרונה: {dateTime(s.lastSeenAt)}</span>
              <PresentNow value={s.presentNow} />
            </div>
          </li>
        ))}
      </ul>

      {/* Laptop: table */}
      {students.length > 0 && (
        <div className="hidden overflow-x-auto card sm:block">
          <table className="w-full text-sm">
            <thead className="bg-surface text-ink-3">
              <tr>
                {['שם משפחה', 'שם פרטי', 'אימייל', 'חשבון', 'נוכחות', 'נראה לאחרונה', ...(live ? ['בשיעור הנוכחי'] : [])].map((h) => (
                  <th key={h} className="px-3 py-2 text-start font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.email} className="border-t border-line">
                  <td className="px-3 py-2 font-medium">{s.lastName}</td>
                  <td className="px-3 py-2">{s.firstName}</td>
                  <td className="px-3 py-2 text-ink-2">
                    <span dir="ltr">{s.email}</span>
                  </td>
                  <td className="px-3 py-2">
                    <AccountBadge registered={s.registered} />
                  </td>
                  <td className="px-3 py-2">
                    <Attendance s={s} />
                  </td>
                  <td className="px-3 py-2 text-ink-2">{dateTime(s.lastSeenAt)}</td>
                  {live && (
                    <td className="px-3 py-2">
                      <PresentNow value={s.presentNow} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
