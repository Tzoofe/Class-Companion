import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  lateText,
  reviewBusy,
  uploadFile,
  type Criterion,
  type LecturerAssignmentDetail,
  type Met,
  type ReviewView,
  type StudentAssignmentDetail,
  type SubmissionView,
} from '../api';
import { useAuth } from '../auth';
import { TextLink } from '../components/Bento';
import GradeChart from '../components/GradeChart';
import { BackLink, ErrorBox, ghostButton, pillButton } from '../components/ui';
import { AssignmentEditor, draftBody, draftFrom, dueText } from './CourseAssignments';

const POLL_MS = 4000;

export const MET_HE: Record<Met, { label: string; cls: string }> = {
  yes: { label: 'עומד/ת בדרישה', cls: 'text-good' },
  partial: { label: 'חלקי', cls: 'text-warn' },
  no: { label: 'חסר', cls: 'text-bad' },
  unknown: { label: 'לא נבדק', cls: 'text-ink-3' },
};

const submittedText = (s: SubmissionView) => `${new Date(s.submittedAt).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}${s.lateMs ? `, באיחור של ${lateText(s.lateMs)}` : ''}`;

/** AI feedback per criterion; with `shares`, how the (anonymous) class did on each one. */
export function ReviewPanel({ review, criteria, shares, showPoints }: { review: ReviewView; criteria: Criterion[]; shares?: Record<string, number> | null; showPoints?: boolean }) {
  if (reviewBusy(review)) return <p className="text-ink-2">ה-AI בודק את ההגשה… זה לוקח דקה או שתיים, אפשר לסגור את הדף.</p>;
  if (review.status === 'failed') return <p className="text-bad">הבדיקה האוטומטית נכשלה{review.error ? ` (${review.error})` : ''}.</p>;
  return (
    <div className="space-y-5">
      {review.summary && <p className="leading-relaxed">{review.summary}</p>}
      <ul className="divide-y divide-line">
        {criteria.map((c) => {
          const r = review.criteria.find((x) => x.criterionId === c.id);
          if (!r) return null;
          const share = shares?.[c.id];
          return (
            <li key={c.id} className="space-y-1 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{c.title}</span>
                <span className={`text-sm ${MET_HE[r.met].cls}`}>
                  {MET_HE[r.met].label}
                  {showPoints && r.points !== undefined && <span className="text-ink-3">, מוצע {r.points} מתוך {c.points}</span>}
                </span>
              </div>
              {r.feedback && <p className="text-sm text-ink-2">{r.feedback}</p>}
              {r.suggestion && <p className="text-sm text-ink-3">לשיפור: {r.suggestion}</p>}
              {share !== undefined && <p className="text-xs text-ink-3">{share}% מהכיתה עמדו בדרישה הזו</p>}
            </li>
          );
        })}
      </ul>
      {(review.strengths.length > 0 || review.improvements.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {review.strengths.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium">נעשה טוב</p>
              <ul className="list-disc space-y-0.5 ps-5 text-sm text-ink-2">
                {review.strengths.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {review.improvements.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium">הכי כדאי לשפר</p>
              <ol className="list-decimal space-y-0.5 ps-5 text-sm text-ink-2">
                {review.improvements.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-ink-3">משוב אוטומטי מ-AI שרץ על שרת הקורס. הוא עלול לטעות, והציון נקבע על ידי המרצה.</p>
    </div>
  );
}

function Upload({ aid, kind, label, disabled, onDone }: { aid: string; kind: 'final' | 'practice'; label: string; disabled?: boolean; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  async function pick(file: File | undefined) {
    if (!file) return;
    setError('');
    setProgress(0);
    try {
      await uploadFile(`/assignments/${aid}/submissions?kind=${kind}&fileName=${encodeURIComponent(file.name)}`, file, setProgress);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept=".pdf,.zip,application/pdf,application/zip" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" disabled={disabled || progress !== null} onClick={() => input.current?.click()} className={kind === 'final' ? pillButton : ghostButton}>
        {progress !== null ? `מעלה… ${Math.round(progress * 100)}%` : label}
      </button>
      <ErrorBox>{error}</ErrorBox>
    </div>
  );
}

// ───────────────────────── Student ─────────────────────────

/** After the deadline: the student's work compared with anonymous class patterns. */
function Comparison({ final, open, dueAt, onRequested }: { final: SubmissionView; open: boolean; dueAt: string; onRequested: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const c = final.comparison;
  const running = c?.status === 'queued' || c?.status === 'running';
  async function request() {
    setBusy(true);
    setError('');
    try {
      await api(`/submissions/${final.id}/compare`, { method: 'POST' });
      onRequested();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const list = (title: string, items: string[]) =>
    items.length > 0 && (
      <div>
        <p className="mb-1 text-sm font-medium">{title}</p>
        <ul className="list-disc space-y-0.5 ps-5 text-sm text-ink-2">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <section className="tile space-y-4 p-6">
      <div>
        <h2 className="text-lg">השוואה לכיתה</h2>
        <p className="mt-1 text-sm text-ink-3">
          {open
            ? 'איך ההגשה שלך נראית לעומת שאר הכיתה: גישות נפוצות, מה אחרים עשו ומה חסר אצלך. ההשוואה אנונימית לגמרי ולא מציגה עבודות של אחרים.'
            : `תיפתח אחרי מועד ההגשה (${dueText(dueAt)}), כדי שלא תרמוז על פתרונות לפני ההגשה.`}
        </p>
      </div>
      {open && !c && (
        <button type="button" disabled={busy || final.review.status !== 'done'} onClick={request} className={pillButton}>
          השוואה לכיתה
        </button>
      )}
      {running && <p className="text-ink-2">משווה את ההגשה שלך לכיתה… זה לוקח פחות מדקה.</p>}
      {c?.status === 'failed' && (
        <div className="space-y-2">
          <p className="text-bad">ההשוואה נכשלה{c.error ? ` (${c.error})` : ''}.</p>
          <button type="button" disabled={busy} onClick={request} className={ghostButton}>
            ניסיון חוזר
          </button>
        </div>
      )}
      {c?.status === 'done' && (
        <div className="space-y-4">
          <p className="leading-relaxed">{c.summary}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {list('כמו רוב הכיתה', c.likeMost)}
            {list('אחרים עשו, ואצלך חסר', c.othersDid)}
            {list('בולט לטובה אצלך', c.standOut)}
          </div>
          <p className="text-xs text-ink-3">בהשוואה ל-{c.classSize} הגשות אחרות. נכתב אוטומטית מתוך הבדיקות, בלי גישה לעבודות של אחרים.</p>
        </div>
      )}
      <ErrorBox>{error}</ErrorBox>
    </section>
  );
}

function StudentView({ data, reload }: { data: StudentAssignmentDetail; reload: () => void }) {
  const a = data.assignment;
  const overdue = new Date(a.dueAt).getTime() < Date.now();
  const final = data.final;
  return (
    <div className="space-y-5">
      <section className="tile space-y-4 p-6">
        <p className={overdue ? 'text-warn' : 'text-ink-2'}>
          {overdue ? `מועד ההגשה עבר (${dueText(a.dueAt)}). עדיין אפשר להגיש, וההגשה תסומן כמאחרת.` : `להגשה עד ${dueText(a.dueAt)}`}
        </p>
        {a.instructions && <p className="whitespace-pre-wrap leading-relaxed">{a.instructions}</p>}
        {a.criteria.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-medium">לפי מה בודקים</p>
            <ul className="space-y-1 text-sm text-ink-2">
              {a.criteria.map((c) => (
                <li key={c.id} className="flex justify-between gap-3">
                  <span>
                    {c.title}
                    {c.description && <span className="text-ink-3">: {c.description}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-3">{c.points} נק׳</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="tile-hero space-y-4 p-6">
        <h2 className="text-xl">ההגשה שלי</h2>
        {final ? (
          <p className="text-ink-2">
            {final.fileName}, הוגש {submittedText(final)}
            {final.lateMs > 0 && <span className="text-warn"> (מאחר)</span>}
          </p>
        ) : (
          <p className="text-ink-2">עוד לא הגשת. אפשר להגיש קובץ PDF או ZIP.</p>
        )}
        <Upload aid={a.id} kind="final" label={final ? 'הגשה מחדש (מחליפה את הקודמת)' : 'הגשה'} onDone={reload} />
        {final?.grade && (
          <div className="rounded-xl bg-surface p-4">
            <p className="font-display text-4xl tabular-nums">
              {final.grade.points}
              <span className="text-xl text-ink-3"> מתוך {a.maxPoints}</span>
            </p>
            {final.grade.comment && <p className="mt-2 whitespace-pre-wrap text-ink-2">{final.grade.comment}</p>}
          </div>
        )}
      </section>

      {final && (
        <section className="tile p-6">
          <h2 className="mb-4 text-lg">משוב על ההגשה</h2>
          <ReviewPanel review={final.review} criteria={a.criteria} shares={data.classShares} />
        </section>
      )}

      {final && <Comparison final={final} open={data.comparisonOpen} dueAt={a.dueAt} onRequested={reload} />}

      {data.gradeStats && final?.grade && (
        <section className="tile p-6">
          <h2 className="mb-4 text-lg">איפה הציון שלך ביחס לכיתה</h2>
          <GradeChart stats={data.gradeStats} maxPoints={a.maxPoints} mine={final.grade.points} />
        </section>
      )}

      <section className="tile space-y-4 p-6">
        <div>
          <h2 className="text-lg">בדיקת טיוטה</h2>
          <p className="mt-1 text-sm text-ink-3">
            לפני ההגשה אפשר להעלות טיוטה ולקבל משוב פרטי מה-AI. הטיוטה לא נחשבת הגשה והמרצה לא רואה אותה. נשארו {data.practiceLeft} מתוך {a.practiceLimit}.
          </p>
        </div>
        <Upload aid={a.id} kind="practice" label="בדיקת טיוטה" disabled={data.practiceLeft === 0} onDone={reload} />
        {data.practice.map((p) => (
          <details key={p.id} className="rounded-xl bg-surface-2 p-4" open={p === data.practice[0]}>
            <summary className="cursor-pointer text-sm">
              {p.fileName}, {submittedText(p)}
            </summary>
            <div className="mt-4">
              <ReviewPanel review={p.review} criteria={a.criteria} shares={data.classShares} />
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}

// ───────────────────────── Lecturer ─────────────────────────

function Similarity({ aid, courseId }: { aid: string; courseId: string }) {
  const [pairs, setPairs] = useState<{ a: { id: string; name: string }; b: { id: string; name: string }; score: number; files: { a: string; b: string; score: number }[] }[] | null>(null);
  const [error, setError] = useState('');
  const check = () => api<{ pairs: NonNullable<typeof pairs> }>(`/assignments/${aid}/similarity`).then((r) => setPairs(r.pairs), (e) => setError(e.message));
  return (
    <section className="tile space-y-3 p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg">הגשות דומות</h2>
        <button type="button" onClick={check} className="text-sm text-ink-2 underline decoration-line-strong underline-offset-4">
          {pairs ? 'בדיקה מחדש' : 'בדיקה'}
        </button>
      </div>
      <p className="text-sm text-ink-3">משווה כל זוג הגשות לפי רצפי מילים משותפים, גם אחרי שינוי שמות קבצים ועיצוב. דמיון גבוה הוא סימן לבדוק, לא הוכחה להעתקה.</p>
      <ErrorBox>{error}</ErrorBox>
      {pairs &&
        (pairs.length === 0 ? (
          <p className="text-ink-2">לא נמצאו הגשות דומות.</p>
        ) : (
          <ul className="divide-y divide-line">
            {pairs.map((p) => (
              <li key={`${p.a.id}-${p.b.id}`} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block">
                    {p.a.name} ו{p.b.name}
                  </span>
                  {p.files[0] && (
                    <span className="block truncate text-ink-3" dir="ltr">
                      {p.files[0].a} ↔ {p.files[0].b}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className={`tabular-nums ${p.score >= 0.7 ? 'text-bad' : 'text-warn'}`}>{Math.round(p.score * 100)}%</span>
                  <TextLink to={`/courses/${courseId}/assignments/${aid}/compare?a=${p.a.id}&b=${p.b.id}`}>השוואה</TextLink>
                </span>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function LecturerView({ data, reload }: { data: LecturerAssignmentDetail; reload: () => void }) {
  const a = data.assignment;
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const graded = data.submissions.filter((s) => s.grade).length;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (editing)
    return (
      <AssignmentEditor
        initial={draftFrom(a)}
        saveLabel="שמירה"
        onCancel={() => setEditing(false)}
        onSubmit={async (d) => {
          await api(`/assignments/${a.id}`, { method: 'PUT', json: draftBody(d) });
          setEditing(false);
          reload();
        }}
      />
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {a.status === 'draft' && (
          <button type="button" disabled={busy} onClick={() => act(() => api(`/assignments/${a.id}`, { method: 'PUT', json: { publish: true } }))} className={pillButton}>
            פרסום לסטודנטים
          </button>
        )}
        {a.status === 'published' && (
          <button
            type="button"
            disabled={busy || (!a.gradesReleased && graded === 0)}
            onClick={() => act(() => api(`/assignments/${a.id}/release`, { method: 'POST', json: { released: !a.gradesReleased } }))}
            className={a.gradesReleased ? ghostButton : pillButton}
          >
            {a.gradesReleased ? 'הסתרת הציונים' : `פרסום ציונים (${graded})`}
          </button>
        )}
        <button type="button" onClick={() => setEditing(true)} className={ghostButton}>
          עריכה
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => window.confirm('למחוק את המטלה ואת כל ההגשות?') && act(async () => (await api(`/assignments/${a.id}`, { method: 'DELETE' }), navigate(`/courses/${id}/assignments`)))}
          className="px-3 text-sm text-bad hover:underline"
        >
          מחיקה
        </button>
      </div>
      <ErrorBox>{error}</ErrorBox>

      <section className="tile-hero p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-xl">הגשות</h2>
          <span className="text-sm text-ink-3">{a.status === 'draft' ? 'טיוטה, הסטודנטים עוד לא רואים' : `עד ${dueText(a.dueAt)}`}</span>
        </div>
        <p className="mt-3 font-display text-4xl tabular-nums">
          {data.submissions.length}
          <span className="text-xl text-ink-3"> מתוך {data.submissions.length + data.missing.length} הגישו</span>
        </p>
        <p className="mt-1 text-sm text-ink-3">
          {data.submissions.filter((s) => s.lateMs > 0).length} באיחור, {graded} קיבלו ציון{a.gradesReleased ? ', הציונים פורסמו' : ''}
        </p>
      </section>

      {data.submissions.length > 0 && (
        <section className="tile p-6">
          <ul className="divide-y divide-line">
            {data.submissions.map((s) => (
              <li key={s.id}>
                <Link to={`/courses/${id}/assignments/${a.id}/submissions/${s.id}`} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <span className="block truncate">{s.name ?? s.email}</span>
                    <span className="block truncate text-sm text-ink-3">
                      {submittedText(s)}
                      {s.practiceUsed ? `, ${s.practiceUsed} בדיקות טיוטה` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-end text-sm">
                    {s.grade ? (
                      <span className="tabular-nums">
                        {s.grade.points} / {a.maxPoints}
                      </span>
                    ) : reviewBusy(s.review) ? (
                      <span className="text-ink-3">בבדיקת AI…</span>
                    ) : s.review.status === 'failed' ? (
                      <span className="text-bad">הבדיקה נכשלה</span>
                    ) : (
                      <span className="text-ink-3">מוצע {s.suggestedPoints ?? '—'}, לבדיקה</span>
                    )}
                    {s.lateMs > 0 && <span className="block text-xs text-warn">איחור {lateText(s.lateMs)}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.gradeStats && (
        <section className="tile p-6">
          <h2 className="mb-4 text-lg">התפלגות ציונים</h2>
          <GradeChart stats={data.gradeStats} maxPoints={a.maxPoints} />
        </section>
      )}

      {data.submissions.length >= 2 && (
        <section className="tile space-y-3 p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg">תמונת מצב של הכיתה</h2>
            <button type="button" disabled={busy} onClick={() => act(() => api(`/assignments/${a.id}/overview`, { method: 'POST' }))} className="text-sm text-ink-2 underline decoration-line-strong underline-offset-4">
              {a.classOverview ? 'עדכון' : 'יצירה'}
            </button>
          </div>
          {a.classOverview ? (
            <>
              <p className="leading-relaxed">{a.classOverview.summary}</p>
              {a.classOverview.commonIssues.length > 0 && (
                <div>
                  <p className="mb-1 text-sm font-medium">טעויות נפוצות</p>
                  <ol className="list-decimal space-y-0.5 ps-5 text-sm text-ink-2">
                    {a.classOverview.commonIssues.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ol>
                </div>
              )}
              <p className="text-xs text-ink-3">לפי {a.classOverview.basedOn} הגשות שנבדקו.</p>
            </>
          ) : (
            <p className="text-sm text-ink-3">סיכום של הטעויות הנפוצות והחוזקות בכיתה, מתוך הבדיקות האוטומטיות. לוקח כדקה.</p>
          )}
        </section>
      )}

      {data.submissions.length >= 2 && <Similarity aid={a.id} courseId={id} />}

      {data.missing.length > 0 && (
        <details className="tile p-6">
          <summary className="cursor-pointer text-lg">לא הגישו ({data.missing.length})</summary>
          <ul className="mt-3 space-y-1 text-sm text-ink-2">
            {data.missing.map((m) => (
              <li key={m.email}>{m.name}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function AssignmentDetail() {
  const { id = '', aid = '' } = useParams();
  const { user } = useAuth();
  const lecturer = user?.role === 'lecturer';
  const [data, setData] = useState<LecturerAssignmentDetail | StudentAssignmentDetail | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api<LecturerAssignmentDetail | StudentAssignmentDetail>(`/assignments/${aid}`).then(setData, (e) => setError(e.message)), [aid]);

  const busy =
    !!data &&
    ('submissions' in data
      ? data.submissions.some((s) => reviewBusy(s.review))
      : !!(data.final && (reviewBusy(data.final.review) || (data.final.comparison && reviewBusy(data.final.comparison)))) || data.practice.some((p) => reviewBusy(p.review)));
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [busy, load]);

  if (!data) return error ? <ErrorBox>{error}</ErrorBox> : <p className="text-ink-3">טוען…</p>;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <BackLink to={`/courses/${id}/assignments`}>מטלות, {data.course.name}</BackLink>
        <h1 className="mt-2 text-3xl">{data.assignment.title}</h1>
      </div>
      {lecturer && 'submissions' in data ? <LecturerView data={data} reload={load} /> : <StudentView data={data as StudentAssignmentDetail} reload={load} />}
    </div>
  );
}
