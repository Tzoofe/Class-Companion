import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type LecturerCourse, type StudentCourse } from '../api';
import { useAuth } from '../auth';
import NotificationsCard from '../components/NotificationsCard';
import { ErrorBox } from '../components/ui';

export default function Courses() {
  const { user } = useAuth();
  const isLecturer = user?.role === 'lecturer';
  const [courses, setCourses] = useState<(LecturerCourse | StudentCourse)[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ courses: (LecturerCourse | StudentCourse)[] }>('/courses')
      .then((r) => setCourses(r.courses))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">הקורסים שלי</h1>
        {isLecturer && (
          <Link to="/courses/new" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            + קורס חדש
          </Link>
        )}
      </div>
      {!isLecturer && <NotificationsCard />}
      <ErrorBox>{error}</ErrorBox>
      {courses === null && !error && <p className="text-slate-500">טוען…</p>}
      {courses?.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
          {isLecturer ? 'עדיין אין קורסים. צרו קורס חדש עם רשימת הסטודנטים.' : 'אינך רשום/ה לאף קורס. אם זו טעות, פנו למרצה כדי שיוסיף את האימייל שלך.'}
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {courses?.map((c) => (
          <li key={c.id}>
            {'rosterCount' in c ? (
              <Link
                to={`/courses/${c.id}`}
                className="block rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:ring-indigo-300"
              >
                <h2 className="font-semibold">{c.name}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {c.rosterCount} סטודנטים · רדיוס {c.defaultRadiusM} מ׳
                </p>
              </Link>
            ) : (
              <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <h2 className="font-semibold">{c.name}</h2>
                {c.lecturerName && <p className="mt-1 text-sm text-slate-500">מרצה: {c.lecturerName}</p>}
                <div className="mt-3 flex gap-2 text-sm font-medium">
                  <Link to={`/courses/${c.id}/checkin`} className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-center text-white hover:bg-indigo-700">
                    סימון נוכחות
                  </Link>
                  <Link to={`/courses/${c.id}/feed`} className="flex-1 rounded-lg bg-white px-3 py-2 text-center text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50">
                    שאלות והערות
                  </Link>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
