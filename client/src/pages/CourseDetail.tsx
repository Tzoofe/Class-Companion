import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type CourseStudents, type StudentRow } from '../api';
import { ErrorBox } from '../components/ui';

const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function percentClass(p: number | null) {
  if (p === null) return 'text-slate-400';
  if (p >= 80) return 'text-emerald-700';
  if (p >= 50) return 'text-amber-700';
  return 'text-red-700';
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
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">רשום/ה</span>
  ) : (
    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">לא נרשם/ה</span>
  );
}

function PresentNow({ value }: { value: boolean | null }) {
  if (value === null) return null;
  return value ? <span className="font-medium text-emerald-700">✓ נוכח/ת</span> : <span className="text-slate-400">— עדיין לא</span>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

export default function CourseDetail() {
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
        <Link to="/courses" className="text-sm text-indigo-700 underline">
          חזרה לקורסים
        </Link>
      </div>
    );
  if (!data) return <p className="text-slate-500">טוען…</p>;

  const { course } = data;
  const live = course.activeSessionId !== null;

  return (
    <div className="space-y-4">
      <div>
        <Link to="/courses" className="text-sm text-slate-500 hover:underline">
          → הקורסים שלי
        </Link>
        <h1 className="mt-1 text-xl font-bold">{course.name}</h1>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="סטודנטים ברשימה" value={course.rosterCount} />
        <Stat label="נרשמו לאפליקציה" value={`${course.registeredCount}/${course.rosterCount}`} />
        <Stat label="מפגשים" value={course.sessionCount} />
        <Stat label="רדיוס" value={`${course.defaultRadiusM} מ׳`} />
      </div>

      {live && (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          מפגש נוכחות פעיל — {data.students.filter((s) => s.presentNow).length} נוכחים כרגע
        </p>
      )}

      <input
        type="search"
        placeholder="חיפוש לפי שם או אימייל"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
      />

      {students.length === 0 && <p className="py-6 text-center text-slate-500">לא נמצאו סטודנטים</p>}

      {/* Phones: cards */}
      <ul className="space-y-2 sm:hidden">
        {students.map((s) => (
          <li key={s.email} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">
                  {s.lastName} {s.firstName}
                </div>
                <div className="truncate text-xs text-slate-500" dir="ltr">
                  {s.email}
                </div>
              </div>
              <AccountBadge registered={s.registered} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span>
                נוכחות: <Attendance s={s} />
              </span>
              <span className="text-slate-500">נראה לאחרונה: {dateTime(s.lastSeenAt)}</span>
              <PresentNow value={s.presentNow} />
            </div>
          </li>
        ))}
      </ul>

      {/* Laptop: table */}
      {students.length > 0 && (
        <div className="hidden overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200 sm:block">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
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
                <tr key={s.email} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{s.lastName}</td>
                  <td className="px-3 py-2">{s.firstName}</td>
                  <td className="px-3 py-2 text-slate-600">
                    <span dir="ltr">{s.email}</span>
                  </td>
                  <td className="px-3 py-2">
                    <AccountBadge registered={s.registered} />
                  </td>
                  <td className="px-3 py-2">
                    <Attendance s={s} />
                  </td>
                  <td className="px-3 py-2 text-slate-600">{dateTime(s.lastSeenAt)}</td>
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
