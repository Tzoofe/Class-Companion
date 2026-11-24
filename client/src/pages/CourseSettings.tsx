import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fileBody, type CourseSettings as Settings } from '../api';
import { ErrorBox, Field, BackLink, Toggle } from '../components/ui';

const card = 'space-y-3 card p-4';
const smallButton = 'btn-primary rounded-full px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50';

function DetailsForm({ course, onSaved }: { course: Settings; onSaved: (c: Settings) => void }) {
  const [name, setName] = useState(course.name);
  const [radius, setRadius] = useState(String(course.defaultRadiusM));
  const [required, setRequired] = useState(course.attendanceRequired);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      onSaved((await api<{ course: Settings }>(`/courses/${course.id}`, { method: 'PATCH', json: { name, defaultRadiusM: Number(radius), attendanceRequired: required } })).course);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={card}>
      <h2 className="">פרטי הקורס</h2>
      <Field label="שם הקורס" value={name} onChange={(e) => setName(e.target.value)} required />
      <Field label="רדיוס נוכחות (מטרים)" type="number" min={5} max={500} value={radius} onChange={(e) => setRadius(e.target.value)} required />
      <p className="text-xs text-ink-3">הרדיוס חל על מפגשי נוכחות חדשים.</p>
      <Toggle
        checked={required}
        onChange={(v) => {
          setRequired(v);
          setSaved(false);
        }}
        label="נוכחות חובה"
        hint={required ? 'סטודנטים מתחת ל-70% נוכחות מופיעים ב"דורש תשומת לב".' : 'הנוכחות נרשמת כרגיל, אבל אף סטודנט/ית לא מסומן/ת בנוכחות נמוכה.'}
      />
      <ErrorBox>{error}</ErrorBox>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={smallButton}>
          {busy ? '…' : 'שמירה'}
        </button>
        {saved && <span className="text-sm text-good">✓ נשמר</span>}
      </div>
    </form>
  );
}

/** Join link / QR: anyone with the code can add themselves to the roster while it's on. */
function JoinLink({ course, onChange }: { course: Settings; onChange: (c: Settings) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function set(body: { open?: boolean; regenerate?: boolean }) {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ joinCode: string | null; joinOpen: boolean }>(`/courses/${course.id}/join`, { method: 'POST', json: body });
      onChange({ ...course, ...r });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={card}>
      <h2>קישור הצטרפות</h2>
      <Toggle
        checked={course.joinOpen}
        onChange={(v) => !busy && set({ open: v })}
        label="סטודנטים יכולים להצטרף בעצמם"
        hint={course.joinOpen ? 'מי שסורק את הקוד או נכנס לקישור מצטרף לרשימת הסטודנטים, עם כל כתובת מייל.' : 'כבוי: רק מי שברשימה שהעליתם נמצא בקורס.'}
      />
      {course.joinOpen && course.joinCode && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="font-display text-2xl tracking-[0.15em]" dir="ltr">
            {course.joinCode}
          </span>
          <Link to={`/courses/${course.id}/demo`} className="text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">
            הצגת הקוד במסך מלא
          </Link>
          <button type="button" disabled={busy} onClick={() => set({ regenerate: true })} className="text-ink-3 underline decoration-line-strong underline-offset-4 hover:text-ink">
            קוד חדש (הישן יפסיק לעבוד)
          </button>
        </div>
      )}
      <ErrorBox>{error}</ErrorBox>
    </div>
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
        <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="שם פרטי" className="rounded-xl border border-line-strong px-3 py-2" />
        <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="שם משפחה" className="rounded-xl border border-line-strong px-3 py-2" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="אימייל" type="email" required dir="ltr" className="rounded-xl border border-line-strong px-3 py-2" />
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
      {result && <p className="text-sm text-good">✓ {result}</p>}
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

  if (!course) return error ? <ErrorBox>{error}</ErrorBox> : <p className="text-ink-3">טוען…</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <BackLink to={`/courses/${id}`}>{course.name}</BackLink>
        <h1 className="mt-1 text-xl">הגדרות הקורס</h1>
      </div>

      <DetailsForm course={course} onSaved={setCourse} />
      <JoinLink course={course} onChange={setCourse} />

      <section className={card}>
        <div className="flex items-baseline justify-between">
          <h2 className="">רשימת הסטודנטים</h2>
          <span className="text-sm text-ink-3">
            {course.roster.length} · {course.roster.filter((s) => s.registered).length} נרשמו לאפליקציה
          </span>
        </div>
        <AddStudent courseId={id} onSaved={setCourse} />
        <details className="rounded-xl bg-surface p-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-2">העלאת קובץ רשימה מעודכן (.csv / .xlsx)</summary>
          <div className="mt-3">
            <Reupload courseId={id} onSaved={setCourse} />
          </div>
        </details>
        <input
          type="search"
          placeholder="חיפוש"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-xl border border-line-strong bg-surface-2 px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <ErrorBox>{error}</ErrorBox>
        <ul className="divide-y divide-line">
          {roster.map((s) => (
            <li key={s.email} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {s.firstName} {s.lastName}
                  {!s.registered && <span className="ms-2 rounded bg-warn-soft px-1.5 py-0.5 text-xs font-normal text-warn">לא נרשם/ה</span>}
                </div>
                <div className="truncate text-xs text-ink-3" dir="ltr">
                  {s.email}
                </div>
              </div>
              <button type="button" disabled={removing === s.email} onClick={() => remove(s.email, `${s.firstName} ${s.lastName}`.trim())} className="shrink-0 text-sm text-bad hover:underline disabled:opacity-50">
                הסרה
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
