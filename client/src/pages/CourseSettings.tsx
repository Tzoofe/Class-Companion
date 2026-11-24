import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fileBody, type CourseSettings as Settings } from '../api';
import { ErrorBox, Field } from '../components/ui';

const card = 'space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200';
const smallButton = 'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50';

function DetailsForm({ course, onSaved }: { course: Settings; onSaved: (c: Settings) => void }) {
  const [name, setName] = useState(course.name);
  const [radius, setRadius] = useState(String(course.defaultRadiusM));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      onSaved((await api<{ course: Settings }>(`/courses/${course.id}`, { method: 'PATCH', json: { name, defaultRadiusM: Number(radius) } })).course);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={card}>
      <h2 className="font-semibold">פרטי הקורס</h2>
      <Field label="שם הקורס" value={name} onChange={(e) => setName(e.target.value)} required />
      <Field label="רדיוס נוכחות (מטרים)" type="number" min={5} max={500} value={radius} onChange={(e) => setRadius(e.target.value)} required />
      <p className="text-xs text-slate-500">הרדיוס חל על מפגשי נוכחות חדשים.</p>
      <ErrorBox>{error}</ErrorBox>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={smallButton}>
          {busy ? '…' : 'שמירה'}
        </button>
        {saved && <span className="text-sm text-emerald-700">✓ נשמר</span>}
      </div>
    </form>
  );
}

function AddStudent({ courseId, onSaved }: { courseId: string; onSaved: (c: Settings) => void }) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSaved((await api<{ course: Settings }>(`/courses/${courseId}/roster`, { method: 'POST', json: { email, firstName, lastName } })).course);
      setEmail('');
      setFirstName('');
      setLastName('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="שם פרטי" className="rounded-lg border border-slate-300 px-3 py-2" />
        <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="שם משפחה" className="rounded-lg border border-slate-300 px-3 py-2" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="אימייל" type="email" required dir="ltr" className="rounded-lg border border-slate-300 px-3 py-2" />
      </div>
      <ErrorBox>{error}</ErrorBox>
      <button type="submit" disabled={busy || !email} className={smallButton}>
        {busy ? '…' : '+ הוספת סטודנט/ית'}
      </button>
    </form>
  );
}

function Reupload({ courseId, onSaved }: { courseId: string; onSaved: (c: Settings) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (mode === 'replace' && !window.confirm('סטודנטים שלא מופיעים בקובץ יוסרו מהקורס. להמשיך?')) return;
    setBusy(true);
    setError('');
    setResult('');
    try {
      const r = await api<{ added: number; updated: number; removed: number; skipped: number; course: Settings }>(`/courses/${courseId}/roster`, {
        method: 'PUT',
        json: await fileBody(file, { mode }),
      });
      onSaved(r.course);
      setResult(`נוספו ${r.added} · עודכנו ${r.updated} · הוסרו ${r.removed}${r.skipped ? ` · ${r.skipped} שורות דולגו` : ''}`);
      setFile(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <input type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
      <fieldset className="space-y-1 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} />
          הוספה ועדכון — סטודנטים קיימים נשארים
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />
          החלפה — מי שלא בקובץ יוסר מהקורס
        </label>
      </fieldset>
      <ErrorBox>{error}</ErrorBox>
      {result && <p className="text-sm text-emerald-700">✓ {result}</p>}
      <button type="submit" disabled={busy || !file} className={smallButton}>
        {busy ? '…' : 'העלאה'}
      </button>
    </form>
  );
}

/** Lecturer: rename the course, change the radius, and manage the roster. */
export default function CourseSettings() {
  const { id = '' } = useParams();
  const [course, setCourse] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [removing, setRemoving] = useState('');

  useEffect(() => {
    api<{ course: Settings }>(`/courses/${id}/settings`).then((r) => setCourse(r.course), (e) => setError(e.message));
  }, [id]);

  const roster = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = course?.roster ?? [];
    return q ? all.filter((s) => `${s.firstName} ${s.lastName} ${s.email}`.toLowerCase().includes(q)) : all;
  }, [course, query]);

  async function remove(email: string, name: string) {
    if (!window.confirm(`להסיר את ${name || email} מהקורס? הנוכחות הקודמת נשמרת, אבל הקורס לא יופיע לו/לה יותר.`)) return;
    setRemoving(email);
    setError('');
    try {
      setCourse((await api<{ course: Settings }>(`/courses/${id}/roster/${encodeURIComponent(email)}`, { method: 'DELETE' })).course);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRemoving('');
    }
  }

  if (!course) return error ? <ErrorBox>{error}</ErrorBox> : <p className="text-slate-500">טוען…</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link to={`/courses/${id}`} className="text-sm text-slate-500 hover:underline">
          → {course.name}
        </Link>
        <h1 className="mt-1 text-xl font-bold">הגדרות הקורס</h1>
      </div>

      <DetailsForm course={course} onSaved={setCourse} />

      <section className={card}>
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">רשימת הסטודנטים</h2>
          <span className="text-sm text-slate-500">
            {course.roster.length} · {course.roster.filter((s) => s.registered).length} נרשמו לאפליקציה
          </span>
        </div>
        <AddStudent courseId={id} onSaved={setCourse} />
        <details className="rounded-lg bg-slate-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">העלאת קובץ רשימה מעודכן (.csv / .xlsx)</summary>
          <div className="mt-3">
            <Reupload courseId={id} onSaved={setCourse} />
          </div>
        </details>
        <input
          type="search"
          placeholder="חיפוש"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
        />
        <ErrorBox>{error}</ErrorBox>
        <ul className="divide-y divide-slate-100">
          {roster.map((s) => (
            <li key={s.email} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {s.firstName} {s.lastName}
                  {!s.registered && <span className="ms-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-normal text-amber-800">לא נרשם/ה</span>}
                </div>
                <div className="truncate text-xs text-slate-500" dir="ltr">
                  {s.email}
                </div>
              </div>
              <button type="button" disabled={removing === s.email} onClick={() => remove(s.email, `${s.firstName} ${s.lastName}`.trim())} className="shrink-0 text-sm text-red-700 hover:underline disabled:opacity-50">
                הסרה
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
