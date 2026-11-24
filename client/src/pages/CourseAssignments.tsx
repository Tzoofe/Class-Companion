import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, lateText, type AssignmentBase, type Criterion, type LecturerAssignmentListItem, type StudentAssignmentListItem } from '../api';
import { useAuth } from '../auth';
import StudentCourseTabs from '../components/StudentCourseTabs';
import { BackLink, ErrorBox, ghostButton, pillButton } from '../components/ui';

export const dueText = (iso: string) => new Date(iso).toLocaleString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

/** "2026-11-30T23:59" in local time, for <input type="datetime-local">. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const field = 'w-full rounded-xl border border-line-strong bg-surface-2 px-3 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';

export interface AssignmentDraft {
  title: string;
  instructions: string;
  dueAt: string; // local datetime-local value
  criteria: Criterion[];
  practiceLimit: number;
}

export const draftFrom = (a?: AssignmentBase): AssignmentDraft =>
  a
    ? { title: a.title, instructions: a.instructions, dueAt: toLocalInput(a.dueAt), criteria: a.criteria, practiceLimit: a.practiceLimit }
    : {
        title: '',
        instructions: '',
        dueAt: (() => {
          const d = new Date(Date.now() + 7 * 864e5);
          d.setHours(23, 59, 0, 0);
          return toLocalInput(d.toISOString());
        })(),
        criteria: [
          { id: 'c1', title: 'נכונות הפתרון', description: '', points: 60 },
          { id: 'c2', title: 'הסבר וניתוח', description: '', points: 25 },
          { id: 'c3', title: 'סגנון ותיעוד', description: '', points: 15 },
        ],
        practiceLimit: 3,
      };

/** Create / edit an assignment: title, instructions, due date, review criteria with points, practice reviews. */
export function AssignmentEditor({ initial, onSubmit, onCancel, saveLabel }: { initial: AssignmentDraft; onSubmit: (d: AssignmentDraft, publish: boolean) => Promise<void>; onCancel?: () => void; saveLabel?: string }) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<AssignmentDraft>) => setD((x) => ({ ...x, ...patch }));
  const setC = (i: number, patch: Partial<Criterion>) => set({ criteria: d.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const total = d.criteria.reduce((n, c) => n + (Number(c.points) || 0), 0);

  async function submit(publish: boolean) {
    setBusy(true);
    setError('');
    try {
      await onSubmit(d, publish);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tile space-y-4 p-6">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">שם המטלה</span>
        <input value={d.title} onChange={(e) => set({ title: e.target.value })} className={field} placeholder="למשל: תרגיל 3, רקורסיה" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">הוראות</span>
        <textarea value={d.instructions} onChange={(e) => set({ instructions: e.target.value })} rows={5} className={field} placeholder="מה צריך להגיש ואיך" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">מועד הגשה</span>
          <input type="datetime-local" value={d.dueAt} onChange={(e) => set({ dueAt: e.target.value })} className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">בדיקות טיוטה לכל סטודנט/ית</span>
          <input type="number" min={0} max={10} value={d.practiceLimit} onChange={(e) => set({ practiceLimit: Number(e.target.value) })} className={field} />
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">
          קריטריונים לבדיקה <span className="font-normal text-ink-3">(סה״כ {total} נקודות)</span>
        </legend>
        <p className="text-xs text-ink-3">ה-AI בודק כל הגשה לפי הקריטריונים האלה ומציע ניקוד. הציון הסופי נקבע על ידך.</p>
        {d.criteria.map((c, i) => (
          <div key={c.id} className="grid grid-cols-[1fr_5rem_auto] items-start gap-2 rounded-xl bg-surface-2 p-3">
            <div className="space-y-2">
              <input value={c.title} onChange={(e) => setC(i, { title: e.target.value })} placeholder="קריטריון" className={field} />
              <input value={c.description} onChange={(e) => setC(i, { description: e.target.value })} placeholder="מה בודקים (לא חובה)" className={`${field} text-sm`} />
            </div>
            <input type="number" min={0} value={c.points} onChange={(e) => setC(i, { points: Number(e.target.value) })} aria-label="ניקוד" className={field} />
            <button type="button" onClick={() => set({ criteria: d.criteria.filter((_, j) => j !== i) })} className="px-2 py-2.5 text-sm text-bad">
              הסרה
            </button>
          </div>
        ))}
        {d.criteria.length < 12 && (
          <button
            type="button"
            onClick={() => set({ criteria: [...d.criteria, { id: `c${Date.now().toString(36)}`, title: '', description: '', points: 10 }] })}
            className="text-sm text-ink-2 underline decoration-line-strong underline-offset-4"
          >
            הוספת קריטריון
          </button>
        )}
      </fieldset>

      <ErrorBox>{error}</ErrorBox>
      <div className="flex flex-wrap gap-2">
        {!saveLabel && (
          <button type="button" disabled={busy} onClick={() => submit(true)} className={pillButton}>
            פרסום לסטודנטים
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => submit(false)} className={saveLabel ? pillButton : ghostButton}>
          {saveLabel ?? 'שמירה כטיוטה'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-3 text-sm text-ink-3">
            ביטול
          </button>
        )}
      </div>
    </div>
  );
}

export const draftBody = (d: AssignmentDraft) => ({
  title: d.title,
  instructions: d.instructions,
  dueAt: new Date(d.dueAt).toISOString(),
  criteria: d.criteria.map((c) => ({ id: c.id, title: c.title, description: c.description, points: Number(c.points) || 0 })),
  maxPoints: d.criteria.reduce((n, c) => n + (Number(c.points) || 0), 0) || 100,
  practiceLimit: d.practiceLimit,
});

/** Course assignments. Lecturer: create and track. Student: what's due and their status. */
export default function CourseAssignments() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const lecturer = user?.role === 'lecturer';
  const [data, setData] = useState<{ course: { id: string; name: string }; assignments: (LecturerAssignmentListItem | StudentAssignmentListItem)[] } | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = () => api<NonNullable<typeof data>>(`/courses/${id}/assignments`).then(setData, (e) => setError(e.message));
  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = Date.now();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {lecturer ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <BackLink to={`/courses/${id}`}>{data?.course.name ?? 'חזרה לקורס'}</BackLink>
            <h1 className="mt-2 text-3xl">מטלות</h1>
          </div>
          {!creating && (
            <button type="button" onClick={() => setCreating(true)} className={pillButton}>
              מטלה חדשה
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <BackLink to="/courses">הקורסים שלי</BackLink>
          {data && <h1 className="text-2xl">{data.course.name}</h1>}
          <StudentCourseTabs courseId={id} active="assignments" />
        </div>
      )}
      <ErrorBox>{error}</ErrorBox>

      {creating && (
        <AssignmentEditor
          initial={draftFrom()}
          onCancel={() => setCreating(false)}
          onSubmit={async (d, publish) => {
            await api(`/courses/${id}/assignments`, { method: 'POST', json: { ...draftBody(d), publish } });
            setCreating(false);
            await load();
          }}
        />
      )}

      {data && (
        <section className="tile p-6">
          {data.assignments.length === 0 ? (
            <p className="text-ink-2">{lecturer ? 'עוד אין מטלות.' : 'אין מטלות כרגע.'}</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.assignments.map((a) => {
                const overdue = new Date(a.dueAt).getTime() < now;
                const lect = 'counts' in a ? a : null;
                const mine = 'mine' in a ? a.mine : null;
                return (
                  <li key={a.id}>
                    <Link to={`/courses/${id}/assignments/${a.id}`} className="block py-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-lg">{a.title}</span>
                        <span className={`shrink-0 text-sm ${overdue ? 'text-ink-3' : 'text-ink-2'}`}>{overdue ? 'נסגר ' : 'עד '}{dueText(a.dueAt)}</span>
                      </div>
                      <p className="mt-0.5 text-sm text-ink-3">
                        {lect
                          ? a.status === 'draft'
                            ? 'טיוטה, הסטודנטים עוד לא רואים'
                            : `הוגשו ${lect.counts.submitted} מתוך ${lect.counts.roster}${lect.counts.late ? `, ${lect.counts.late} באיחור` : ''}, נבדקו ${lect.counts.graded}${a.gradesReleased ? ', הציונים פורסמו' : ''}`
                          : mine
                            ? `הוגש${mine.lateMs ? ` באיחור של ${lateText(mine.lateMs)}` : ''}${mine.grade !== null ? `, ציון ${mine.grade} מתוך ${a.maxPoints}` : ''}`
                            : overdue
                              ? 'לא הוגש. עדיין אפשר להגיש, ההגשה תסומן כמאחרת'
                              : 'עוד לא הוגש'}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
