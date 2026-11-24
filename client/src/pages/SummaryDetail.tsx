import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, isProcessing, type LessonSummaryView, type SummaryContent } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, BackLink, ghostButton, pillButton } from '../components/ui';
import { STATUS_HE, fmtDate } from './CourseSummaries';

const POLL_MS = 3000;

const clock = (sec: number) => {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

interface Detail {
  course: { id: string; name: string };
  summary: LessonSummaryView;
  transcript?: { start: number; end: number; text: string }[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="tile p-6">
      <h2 className="mb-3 text-lg">{title}</h2>
      {children}
    </section>
  );
}

const lines = (xs: string[]) => xs.join('\n');
const unlines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);

/** Read view (students and lecturer). */
function Content({ c }: { c: SummaryContent }) {
  return (
    <div className="space-y-5">
      {c.overview && (
        <section className="tile-hero p-6">
          <h2 className="mb-2 text-lg">בקצרה</h2>
          <p className="leading-relaxed">{c.overview}</p>
        </section>
      )}
      {c.topics.length > 0 && (
        <Section title="נושאי השיעור">
          <ol className="space-y-4">
            {c.topics.map((t, i) => (
              <li key={i} className="flex gap-4">
                <span className="w-14 shrink-0 pt-0.5 text-sm tabular-nums text-ink-3" dir="ltr">
                  {t.at !== null ? clock(t.at) : ''}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{t.title}</p>
                  {t.points.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-ink-2">
                      {t.points.map((p, j) => (
                        <li key={j}>{p}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}
      {c.concepts.length > 0 && (
        <Section title="מושגים">
          <dl className="divide-y divide-line">
            {c.concepts.map((x, i) => (
              <div key={i} className="py-2.5">
                <dt className="font-medium">{x.term}</dt>
                <dd className="text-sm text-ink-2">{x.definition}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
      {c.reminders.length > 0 && (
        <Section title="חשוב לזכור">
          <ul className="list-disc space-y-1 ps-5">
            {c.reminders.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Section>
      )}
      {c.confusion.length > 0 && (
        <Section title="נקודות שהיו קשות בשיעור">
          <ul className="list-disc space-y-1 ps-5 text-ink-2">
            {c.confusion.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Section>
      )}
      {c.reviewQuestions.length > 0 && (
        <Section title="שאלות לחזרה">
          <ol className="list-decimal space-y-1 ps-5">
            {c.reviewQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </Section>
      )}
    </div>
  );
}

/** Edit view: plain text areas, one line per item. Topics and concepts keep their structure as "title: point; point". */
function Editor({ s, onSaved, onCancel }: { s: LessonSummaryView; onSaved: (s: LessonSummaryView) => void; onCancel: () => void }) {
  const c = s.content;
  const [title, setTitle] = useState(s.title);
  const [overview, setOverview] = useState(c.overview);
  const [topics, setTopics] = useState(c.topics.map((t) => [t.title, ...t.points].join(' | ')).join('\n'));
  const [concepts, setConcepts] = useState(c.concepts.map((x) => `${x.term}: ${x.definition}`).join('\n'));
  const [reminders, setReminders] = useState(lines(c.reminders));
  const [confusion, setConfusion] = useState(lines(c.confusion));
  const [review, setReview] = useState(lines(c.reviewQuestions));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    const parsedTopics = unlines(topics).map((line, i) => {
      const [t, ...points] = line.split('|').map((x) => x.trim());
      return { at: c.topics[i]?.title === t ? c.topics[i].at : null, title: t, points: points.filter(Boolean) };
    });
    const parsedConcepts = unlines(concepts).map((line) => {
      const k = line.indexOf(':');
      return k > 0 ? { term: line.slice(0, k).trim(), definition: line.slice(k + 1).trim() } : { term: line, definition: '' };
    });
    try {
      const r = await api<{ summary: LessonSummaryView }>(`/summaries/${s.id}`, {
        method: 'PUT',
        json: { title, content: { overview, topics: parsedTopics, concepts: parsedConcepts, reminders: unlines(reminders), confusion: unlines(confusion), reviewQuestions: unlines(review) } },
      });
      onSaved(r.summary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const area = (label: string, value: string, set: (v: string) => void, hint: string, rows = 4) => (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <span className="mb-1 block text-xs text-ink-3">{hint}</span>
      <textarea value={value} onChange={(e) => set(e.target.value)} rows={rows} className="w-full rounded-xl border border-line-strong bg-surface-2 px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
    </label>
  );

  return (
    <div className="tile space-y-5 p-6">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">כותרת</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-xl border border-line-strong bg-surface-2 px-3 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
      </label>
      {area('בקצרה', overview, setOverview, '', 4)}
      {area('נושאי השיעור', topics, setTopics, 'שורה לכל נושא: כותרת | נקודה | נקודה', 8)}
      {area('מושגים', concepts, setConcepts, 'שורה לכל מושג: מונח: הגדרה')}
      {area('חשוב לזכור', reminders, setReminders, 'שורה לכל פריט')}
      {area('נקודות שהיו קשות בשיעור', confusion, setConfusion, 'שורה לכל פריט')}
      {area('שאלות לחזרה', review, setReview, 'שורה לכל שאלה')}
      <ErrorBox>{error}</ErrorBox>
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy} className={pillButton}>
          {busy ? '…' : 'שמירה'}
        </button>
        <button type="button" onClick={onCancel} className={ghostButton}>
          ביטול
        </button>
      </div>
    </div>
  );
}

export default function SummaryDetail() {
  const { id = '', summaryId = '' } = useParams();
  const { user } = useAuth();
  const lecturer = user?.role === 'lecturer';
  const navigate = useNavigate();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<Detail>(`/summaries/${summaryId}`).then(setData, (e) => setError(e.message)), [summaryId]);
  const working = data ? isProcessing(data.summary) : false;
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [working, load]);

  async function act(path: string, init: Parameters<typeof api>[1]) {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ summary?: LessonSummaryView }>(path, init);
      if (r.summary) setData((d) => d && { ...d, summary: r.summary! });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <ErrorBox>{error}</ErrorBox> : <p className="text-ink-3">טוען…</p>;
  const s = data.summary;
  const ready = s.status === 'draft' || s.status === 'published';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <BackLink to={`/courses/${id}/summaries`}>סיכומי שיעורים, {data.course.name}</BackLink>
        <h1 className="mt-2 text-3xl">{s.title || 'סיכום שיעור'}</h1>
        <p className="mt-1 text-ink-3">
          {fmtDate(s.date)}
          {lecturer && <span className={s.status === 'published' ? 'text-good' : s.status === 'failed' ? 'text-bad' : ''}>, {STATUS_HE[s.status]}</span>}
        </p>
      </div>

      {lecturer && ready && !editing && (
        <div className="flex flex-wrap gap-2">
          {s.status === 'draft' ? (
            <button type="button" disabled={busy} onClick={() => act(`/summaries/${s.id}/publish`, { method: 'POST', json: { published: true } })} className={pillButton}>
              פרסום לסטודנטים
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => act(`/summaries/${s.id}/publish`, { method: 'POST', json: { published: false } })} className={ghostButton}>
              החזרה לטיוטה
            </button>
          )}
          <button type="button" onClick={() => setEditing(true)} className={ghostButton}>
            עריכה
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => window.confirm('לכתוב את הסיכום מחדש מהתמלול? העריכות שלך יימחקו.') && act(`/summaries/${s.id}/retry`, { method: 'POST' })}
            className={ghostButton}
          >
            כתיבה מחדש
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm('למחוק את הסיכום ואת התמלול?')) return;
              await act(`/summaries/${s.id}`, { method: 'DELETE' });
              navigate(`/courses/${id}/summaries`);
            }}
            className="px-3 text-sm text-bad hover:underline"
          >
            מחיקה
          </button>
        </div>
      )}
      <ErrorBox>{error}</ErrorBox>

      {working && (
        <section className="tile p-6">
          <p>{STATUS_HE[s.status]}…</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(3, s.progress)}%` }} />
          </div>
          <p className="mt-2 text-sm text-ink-3">אפשר לסגור את הדף. התהליך ממשיך ברקע, והסיכום יחכה כאן כטיוטה.</p>
        </section>
      )}

      {s.status === 'failed' && (
        <section className="tile space-y-3 p-6">
          <p className="text-bad">העיבוד נכשל.</p>
          {s.error && <p className="text-sm text-ink-3" dir="ltr">{s.error}</p>}
          {lecturer && (
            <button type="button" disabled={busy} onClick={() => act(`/summaries/${s.id}/retry`, { method: 'POST' })} className={pillButton}>
              ניסיון חוזר
            </button>
          )}
        </section>
      )}

      {ready && (editing ? <Editor s={s} onSaved={(x) => (setData((d) => d && { ...d, summary: x }), setEditing(false))} onCancel={() => setEditing(false)} /> : <Content c={s.content} />)}

      {lecturer && data.transcript && data.transcript.length > 0 && (
        <details className="tile p-6">
          <summary className="cursor-pointer text-lg">תמלול מלא</summary>
          <div className="mt-4 max-h-[32rem] space-y-2 overflow-y-auto text-sm leading-relaxed text-ink-2">
            {data.transcript.map((t, i) => (
              <p key={i}>
                {t.end > 0 && (
                  <span className="me-2 tabular-nums text-ink-4" dir="ltr">
                    {clock(t.start)}
                  </span>
                )}
                {t.text}
              </p>
            ))}
          </div>
        </details>
      )}
      {lecturer && ready && <p className="text-xs text-ink-3">הסיכום נכתב אוטומטית ועלול לטעות, במיוחד במונחים מקצועיים. בדקו ותקנו לפני הפרסום.</p>}
    </div>
  );
}
