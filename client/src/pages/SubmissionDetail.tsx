import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, downloadFile, lateText, reviewBusy, type AssignmentBase, type SubmissionView } from '../api';
import { BackLink, ErrorBox, ghostButton, pillButton } from '../components/ui';
import { ReviewPanel } from './AssignmentDetail';

interface Detail {
  assignment: AssignmentBase;
  submission: SubmissionView;
  contents: { path: string; text: string; code: boolean }[];
}

const POLL_MS = 4000;

/** The submitted files as text, one collapsible block per file. */
function Contents({ contents }: { contents: Detail['contents'] }) {
  return (
    <div className="space-y-2">
      {contents.map((f, i) => (
        <details key={f.path} className="rounded-xl bg-surface-2" open={i === 0 && contents.length < 4}>
          <summary className="cursor-pointer px-4 py-3 text-sm" dir="ltr">
            {f.path}
          </summary>
          <pre className={`max-h-[28rem] overflow-auto whitespace-pre-wrap break-words px-4 pb-4 text-xs leading-relaxed ${f.code ? 'font-mono' : ''}`} dir={f.code ? 'ltr' : 'auto'}>
            {f.text}
          </pre>
        </details>
      ))}
    </div>
  );
}

/** Lecturer: AI review, grading form (prefilled with the AI's suggestion), the files. */
export default function SubmissionDetail() {
  const { id = '', aid = '', sid = '' } = useParams();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [points, setPoints] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(
    () =>
      api<Detail>(`/submissions/${sid}`).then((d) => {
        setData(d);
        const s = d.submission;
        setPoints(Object.fromEntries(d.assignment.criteria.map((c) => [c.id, s.grade?.criteria.find((g) => g.criterionId === c.id)?.points ?? s.review.criteria.find((r) => r.criterionId === c.id)?.points ?? 0])));
        setComment(s.grade?.comment ?? '');
      }, (e) => setError(e.message)),
    [sid],
  );
  const busy = data ? reviewBusy(data.submission.review) : false;
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [busy, load]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      const r = await api<{ submission: SubmissionView }>(`/submissions/${sid}/grade`, {
        method: 'PUT',
        json: { criteria: Object.entries(points).map(([criterionId, p]) => ({ criterionId, points: p })), comment },
      });
      setData((d) => d && { ...d, submission: r.submission });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!data) return error ? <ErrorBox>{error}</ErrorBox> : <p className="text-ink-3">טוען…</p>;
  const { assignment: a, submission: s } = data;
  const total = a.criteria.reduce((n, c) => n + (points[c.id] ?? 0), 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <BackLink to={`/courses/${id}/assignments/${aid}`}>{a.title}</BackLink>
        <h1 className="mt-2 text-3xl">{s.name ?? s.email}</h1>
        <p className="mt-1 text-ink-3">
          {s.fileName}, הוגש {new Date(s.submittedAt).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}
          {s.lateMs > 0 && <span className="text-warn">, באיחור של {lateText(s.lateMs)}</span>}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => downloadFile(`/submissions/${sid}/file`, s.fileName).catch((e) => setError(e.message))} className={ghostButton}>
          הורדת הקובץ המקורי
        </button>
        {!busy && (
          <button type="button" onClick={() => api(`/submissions/${sid}/review`, { method: 'POST' }).then(load, (e) => setError(e.message))} className={ghostButton}>
            בדיקת AI מחדש
          </button>
        )}
      </div>
      <ErrorBox>{error}</ErrorBox>

      <section className="tile-hero space-y-4 p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl">ציון</h2>
          <p className="font-display text-3xl tabular-nums">
            {Math.round(total * 10) / 10}
            <span className="text-lg text-ink-3"> / {a.maxPoints}</span>
          </p>
        </div>
        <ul className="space-y-2">
          {a.criteria.map((c) => {
            const suggested = s.review.criteria.find((r) => r.criterionId === c.id)?.points;
            return (
              <li key={c.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block">{c.title}</span>
                  {suggested !== undefined && <span className="block text-xs text-ink-3">AI הציע {suggested}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-sm text-ink-3">
                  <input
                    type="number"
                    min={0}
                    max={c.points}
                    step="0.5"
                    value={points[c.id] ?? 0}
                    onChange={(e) => {
                      setSaved(false);
                      setPoints((p) => ({ ...p, [c.id]: Math.min(Math.max(Number(e.target.value), 0), c.points) }));
                    }}
                    aria-label={`ניקוד ${c.title}`}
                    className="w-20 rounded-xl border border-line-strong bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
                  />
                  / {c.points}
                </span>
              </li>
            );
          })}
        </ul>
        <textarea
          value={comment}
          onChange={(e) => {
            setSaved(false);
            setComment(e.target.value);
          }}
          rows={3}
          placeholder="הערה לסטודנט/ית (תוצג עם הציון)"
          className="w-full rounded-xl border border-line-strong bg-surface px-3 py-2.5 outline-none focus:border-accent"
        />
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={saving} className={pillButton}>
            {saving ? '…' : s.grade ? 'עדכון הציון' : 'שמירת הציון'}
          </button>
          {saved && <span className="text-sm text-good">נשמר. הסטודנט/ית יראה/תראה אותו כשתפרסמו את הציונים.</span>}
        </div>
      </section>

      <section className="tile p-6">
        <h2 className="mb-4 text-lg">בדיקת AI</h2>
        <ReviewPanel review={s.review} criteria={a.criteria} showPoints />
      </section>

      <section className="tile p-6">
        <h2 className="mb-4 text-lg">הקבצים שהוגשו</h2>
        <Contents contents={data.contents} />
      </section>
    </div>
  );
}

/** Two similar submissions side by side. */
export function CompareSubmissions() {
  const { id = '', aid = '' } = useParams();
  const [params] = useSearchParams();
  const [pair, setPair] = useState<[Detail, Detail] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([api<Detail>(`/submissions/${params.get('a')}`), api<Detail>(`/submissions/${params.get('b')}`)]).then((r) => setPair(r as [Detail, Detail]), (e) => setError(e.message));
  }, [params]);
  if (!pair) return error ? <ErrorBox>{error}</ErrorBox> : <p className="text-ink-3">טוען…</p>;
  return (
    <div className="space-y-6">
      <div>
        <BackLink to={`/courses/${id}/assignments/${aid}`}>{pair[0].assignment.title}</BackLink>
        <h1 className="mt-2 text-3xl">השוואת הגשות</h1>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {pair.map((d) => (
          <section key={d.submission.id} className="tile min-w-0 p-6">
            <h2 className="mb-1 text-lg">{d.submission.name ?? d.submission.email}</h2>
            <p className="mb-4 text-sm text-ink-3">{d.submission.fileName}</p>
            <Contents contents={d.contents} />
          </section>
        ))}
      </div>
    </div>
  );
}
