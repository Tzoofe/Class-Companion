import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type CoursePolls as Polls, type LecturerPoll, type PollAnswer, type PollDraft, type StudentPoll } from '../api';
import { useAuth } from '../auth';
import PollEditor, { draftFromPoll, emptyDraft, toBody } from '../components/PollEditor';
import PollResults from '../components/PollResults';
import StudentCourseTabs from '../components/StudentCourseTabs';
import { ErrorBox, BackLink } from '../components/ui';

const LIVE_POLL_MS = 2500;
const IDLE_POLL_MS = 6000;

const TYPE_LABEL = { choice: 'בחירה', yesno: 'כן / לא', scale: 'סולם 1–5', text: 'טקסט חופשי' } as const;
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

/** One-tap polls for the lesson. */
const QUICK: { label: string; draft: Partial<PollDraft> }[] = [
  { label: 'הבנתם?', draft: { question: 'הבנתם את מה שלמדנו עכשיו?', type: 'choice', options: ['כן, הכל ברור', 'בערך', 'לא, צריך הסבר נוסף'] } },
  { label: 'קצב השיעור', draft: { question: 'איך הקצב של השיעור?', type: 'choice', options: ['איטי מדי', 'בדיוק', 'מהיר מדי'] } },
];

/** Re-fetches on an interval (faster while something is live). */
function usePolling<T>(path: string, liveFn: (d: T) => boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(
    () =>
      api<T>(path).then(
        (d) => {
          setData(d);
          setError('');
        },
        (e) => setError(e.message),
      ),
    [path],
  );
  const live = data ? liveFn(data) : false;
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), live ? LIVE_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(t);
  }, [load, live]);
  return { data, setData, error, setError, reload: load };
}

function Badge({ children, tone }: { children: ReactNode; tone: 'green' | 'slate' | 'amber' | 'indigo' }) {
  const cls = { green: 'bg-good-soft text-good', slate: 'bg-surface-2 text-ink-2', amber: 'bg-warn-soft text-warn', indigo: 'bg-accent-soft text-accent-ink' }[tone];
  return <span className={`rounded px-1.5 py-0.5 text-xs ${cls}`}>{children}</span>;
}

// ───────────────────────── Lecturer ─────────────────────────

function LecturerPollCard({ p, sessionActive, onChanged, onRemoved }: { p: LecturerPoll; sessionActive: boolean; onChanged: (p: LecturerPoll) => void; onRemoved: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(p.status === 'open');

  async function act(path: string, init: Parameters<typeof api>[1], after?: (r: { poll?: LecturerPoll }) => void) {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ poll?: LecturerPoll }>(path, init);
      if (after) after(r);
      else if (r.poll) onChanged(r.poll);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (editing)
    return (
      <PollEditor
        initial={draftFromPoll(p)}
        sessionActive={sessionActive}
        submitLabels={{ save: 'שמירת טיוטה' }}
        onCancel={() => setEditing(false)}
        onSubmit={async (d) => {
          onChanged((await api<{ poll: LecturerPoll }>(`/polls/${p.id}`, { method: 'PUT', json: toBody(d) })).poll);
          setEditing(false);
        }}
      />
    );

  const open = p.status === 'open';
  return (
    <li className={`card p-4 ring-1 ${open ? 'ring-2 ring-accent/70' : 'ring-line'}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        {open ? <Badge tone="green">● פתוח</Badge> : p.status === 'draft' ? <Badge tone="slate">טיוטה</Badge> : <Badge tone="slate">נסגר</Badge>}
        <span>{TYPE_LABEL[p.type]}{p.multiple && ' · כמה תשובות'}</span>
        {p.audience === 'present' && <Badge tone="amber">רק לנוכחים</Badge>}
        {p.resultsRevealed && <Badge tone="indigo">התוצאות מוצגות לסטודנטים</Badge>}
        {p.openedAt && <span>· {when(p.openedAt)}</span>}
      </div>
      <button type="button" onClick={() => setExpanded((x) => !x)} className="mt-1.5 block w-full text-start text-lg font-semibold">
        {p.question}
      </button>

      {p.status !== 'draft' && (
        <p className="mt-1 text-sm text-ink-2">
          <strong className="tabular-nums">{p.results.responses}</strong>/{p.eligible} ענו
        </p>
      )}

      {(expanded || open) && p.status !== 'draft' && (
        <div className="mt-3">
          <PollResults type={p.type} options={p.options} results={p.results} correctOptionIds={p.correctOptionIds} />
        </div>
      )}
      {p.status === 'draft' && p.options.length > 0 && (
        <ul className="mt-2 list-disc ps-5 text-sm text-ink-2">
          {p.options.map((o) => (
            <li key={o.id}>
              {o.text}
              {p.correctOptionIds.includes(o.id) && <span className="ms-1 text-good">✓</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3 text-sm">
        {open && (
          <button type="button" disabled={busy} onClick={() => act(`/polls/${p.id}/close`, { method: 'POST' })} className="rounded-xl bg-ink px-3 py-1.5 font-medium text-bg disabled:opacity-50">
            סגירת הסקר
          </button>
        )}
        {!open && (
          <button type="button" disabled={busy} onClick={() => act(`/polls/${p.id}/open`, { method: 'POST' })} className="btn-primary rounded-full px-3 py-1.5 font-medium text-white disabled:opacity-50">
            {p.status === 'draft' ? 'פתיחה' : 'פתיחה מחדש'}
          </button>
        )}
        {p.status !== 'draft' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(`/polls/${p.id}/reveal`, { method: 'POST', json: { revealed: !p.resultsRevealed } })}
            className="rounded-xl px-3 py-1.5 text-accent-ink ring-1 ring-accent/40 hover:bg-accent-soft disabled:opacity-50"
          >
            {p.resultsRevealed ? 'הסתרת התוצאות מהסטודנטים' : 'הצגת התוצאות לסטודנטים'}
          </button>
        )}
        {p.status === 'draft' && (
          <button type="button" onClick={() => setEditing(true)} className="rounded-xl px-3 py-1.5 text-ink-2 ring-1 ring-line-strong hover:bg-surface">
            עריכה
          </button>
        )}
        {p.status !== 'draft' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(`/polls/${p.id}/duplicate`, { method: 'POST' }, (r) => r.poll && onChanged(r.poll))}
            className="rounded-xl px-3 py-1.5 text-ink-2 ring-1 ring-line-strong hover:bg-surface"
          >
            שכפול לטיוטה
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => window.confirm('למחוק את הסקר ואת כל התשובות?') && act(`/polls/${p.id}`, { method: 'DELETE' }, () => onRemoved(p.id))}
          className="px-2 py-1.5 text-bad hover:underline"
        >
          מחיקה
        </button>
      </div>
      <ErrorBox>{error}</ErrorBox>
    </li>
  );
}

function LecturerPolls({ courseId }: { courseId: string }) {
  const { data, setData, error } = usePolling<Polls<LecturerPoll>>(`/courses/${courseId}/polls`, (d) => d.polls.some((p) => p.status === 'open'));
  const [sessionActive, setSessionActive] = useState(false);
  const [creating, setCreating] = useState<PollDraft | null>(null);
  const [quickError, setQuickError] = useState('');

  useEffect(() => {
    api<{ session: unknown }>(`/courses/${courseId}/sessions/active`).then((r) => setSessionActive(!!r.session), () => {});
  }, [courseId, data]);

  // Keep the open poll first, then newest.
  const upsert = (p: LecturerPoll) =>
    setData((d) => {
      if (!d) return d;
      const others = d.polls.filter((x) => x.id !== p.id).map((x) => (p.status === 'open' && x.status === 'open' ? { ...x, status: 'closed' as const } : x));
      const all = [p, ...others].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return { ...d, polls: all };
    });
  const remove = (id: string) => setData((d) => d && { ...d, polls: d.polls.filter((x) => x.id !== id) });

  async function create(draft: PollDraft, open: boolean) {
    const r = await api<{ poll: LecturerPoll }>(`/courses/${courseId}/polls`, { method: 'POST', json: { ...toBody(draft), open } });
    upsert(r.poll);
    setCreating(null);
  }

  async function quick(d: Partial<PollDraft>) {
    setQuickError('');
    try {
      await create({ ...emptyDraft(), ...d }, true);
    } catch (e) {
      setQuickError((e as Error).message);
    }
  }

  const polls = data?.polls ?? [];
  const drafts = polls.filter((p) => p.status === 'draft');
  const others = polls.filter((p) => p.status !== 'draft');

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <BackLink to={`/courses/${courseId}`}>{data?.course.name ?? 'חזרה לקורס'}</BackLink>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl">סקרים</h1>
          <Link to={`/courses/${courseId}/polls/present`} className="rounded-full bg-surface-2 px-4 py-2 text-sm font-medium text-ink ring-1 ring-line hover:bg-surface-3">
            מסך הקרנה
          </Link>
        </div>
      </div>

      {creating ? (
        <PollEditor initial={creating} sessionActive={sessionActive} onSubmit={create} onCancel={() => setCreating(null)} submitLabels={{ open: 'פתיחה עכשיו', save: 'שמירה כטיוטה' }} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setCreating(emptyDraft())} className="btn-primary rounded-full px-4 py-2 text-sm font-medium text-white hover:brightness-110">
            + סקר חדש
          </button>
          <span className="text-sm text-ink-3">או בלחיצה אחת:</span>
          {QUICK.map((q) => (
            <button key={q.label} type="button" onClick={() => quick(q.draft)} className="rounded-full bg-surface-2 px-3 py-1.5 text-sm ring-1 ring-line-strong hover:bg-surface">
              {q.label}
            </button>
          ))}
        </div>
      )}
      <ErrorBox>{quickError || error}</ErrorBox>
      {!data && !error && <p className="text-center text-ink-3">טוען…</p>}

      {drafts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm text-ink-3">טיוטות</h2>
          <ul className="space-y-3">
            {drafts.map((p) => (
              <LecturerPollCard key={p.id} p={p} sessionActive={sessionActive} onChanged={upsert} onRemoved={remove} />
            ))}
          </ul>
        </section>
      )}

      {others.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm text-ink-3">סקרים</h2>
          <ul className="space-y-3">
            {others.map((p) => (
              <LecturerPollCard key={p.id} p={p} sessionActive={sessionActive} onChanged={upsert} onRemoved={remove} />
            ))}
          </ul>
        </section>
      )}

      {data && polls.length === 0 && !creating && (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2 p-8 text-center text-ink-2">עוד אין סקרים. צרו סקר חדש או השתמשו בסקר מהיר.</div>
      )}
    </div>
  );
}

// ───────────────────────── Student ─────────────────────────

function AnswerForm({ p, onSaved }: { p: StudentPoll; onSaved: (p: StudentPoll) => void }) {
  const [choice, setChoice] = useState<string[]>(p.myAnswer?.optionIds ?? []);
  const [value, setValue] = useState<number | undefined>(p.myAnswer?.value);
  const [text, setText] = useState(p.myAnswer?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(!!p.myAnswer);

  async function save(answer: PollAnswer) {
    setBusy(true);
    setError('');
    try {
      onSaved((await api<{ poll: StudentPoll }>(`/polls/${p.id}/response`, { method: 'PUT', json: answer })).poll);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function pick(id: string) {
    setSaved(false);
    if (p.multiple) setChoice((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
    else {
      setChoice([id]);
      void save({ optionIds: [id] }); // single choice: saves on tap
    }
  }

  return (
    <div className="space-y-3">
      {(p.type === 'choice' || p.type === 'yesno') && (
        <div className={p.type === 'yesno' ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>
          {p.options.map((o) => {
            const on = choice.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                disabled={busy}
                role={p.multiple ? 'checkbox' : 'radio'}
                aria-checked={on}
                onClick={() => pick(o.id)}
                className={`w-full rounded-2xl px-4 py-3 text-start text-base ring-1 transition ${on ? 'bg-accent text-white ring-accent' : 'bg-surface-2 ring-line-strong hover:bg-surface'} ${p.type === 'yesno' ? 'text-center text-lg font-medium' : ''}`}
              >
                {p.multiple && <span className="me-2">{on ? '☑' : '☐'}</span>}
                {o.text}
              </button>
            );
          })}
          {p.multiple && (
            <button type="button" disabled={busy || choice.length === 0} onClick={() => save({ optionIds: choice })} className="w-full btn-primary rounded-full px-4 py-2.5 font-medium text-white disabled:opacity-50">
              {busy ? '…' : 'שליחה'}
            </button>
          )}
        </div>
      )}

      {p.type === 'scale' && (
        <div>
          <div className="grid grid-cols-5 gap-2" dir="ltr">
            {[1, 2, 3, 4, 5].map((v) => (
              <button
                key={v}
                type="button"
                disabled={busy}
                aria-pressed={value === v}
                onClick={() => {
                  setValue(v);
                  setSaved(false);
                  void save({ value: v });
                }}
                className={`rounded-2xl py-3 text-xl font-semibold ring-1 ${value === v ? 'bg-accent text-white ring-accent' : 'bg-surface-2 ring-line-strong'}`}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-ink-3" dir="ltr">
            <span>1 · בכלל לא</span>
            <span>5 · מאוד</span>
          </div>
        </div>
      )}

      {p.type === 'text' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({ text });
          }}
          className="space-y-2"
        >
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value.slice(0, 200));
              setSaved(false);
            }}
            placeholder="התשובה שלך"
            className="w-full rounded-xl border border-line-strong px-3 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
          <button type="submit" disabled={busy || !text.trim()} className="w-full btn-primary rounded-full px-4 py-2.5 font-medium text-white disabled:opacity-50">
            {busy ? '…' : 'שליחה'}
          </button>
        </form>
      )}

      {saved && !busy && <p className="text-sm text-good">✓ התשובה נשמרה — אפשר לשנות עד שהסקר נסגר</p>}
      <ErrorBox>{error}</ErrorBox>
    </div>
  );
}

function StudentPollCard({ p, onSaved }: { p: StudentPoll; onSaved: (p: StudentPoll) => void }) {
  const open = p.status === 'open';
  return (
    <li className={`card p-4 ring-1 ${open && p.canAnswer ? 'ring-2 ring-accent/70' : 'ring-line'}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        {open ? <Badge tone="green">● פתוח</Badge> : <Badge tone="slate">נסגר</Badge>}
        {p.multiple && <span>אפשר לבחור כמה תשובות</span>}
        {p.openedAt && <span>{when(p.openedAt)}</span>}
      </div>
      <p className="mt-1.5 text-lg font-semibold">{p.question}</p>
      <div className="mt-3">
        {open && p.canAnswer ? (
          <AnswerForm p={p} onSaved={onSaved} />
        ) : open && !p.eligible ? (
          <p className="text-sm text-warn">הסקר פתוח רק למי שסימן/ה נוכחות בשיעור.</p>
        ) : null}
        {p.results ? (
          <div className={open && p.canAnswer ? 'mt-4 border-t border-line pt-3' : ''}>
            <p className="mb-2 text-xs font-medium text-ink-3">תוצאות · {p.results.responses} ענו</p>
            <PollResults type={p.type} options={p.options} results={p.results} correctOptionIds={p.correctOptionIds} mine={p.myAnswer ?? undefined} />
          </div>
        ) : (
          !open && <p className="text-sm text-ink-3">{p.myAnswer ? 'ענית על הסקר. ' : ''}התוצאות עוד לא פורסמו.</p>
        )}
      </div>
    </li>
  );
}

function StudentPolls({ courseId }: { courseId: string }) {
  const { data, setData, error } = usePolling<Polls<StudentPoll>>(`/courses/${courseId}/polls`, (d) => d.polls.some((p) => p.status === 'open'));
  const replace = (p: StudentPoll) => setData((d) => d && { ...d, polls: d.polls.map((x) => (x.id === p.id ? p : x)) });
  const polls = data?.polls ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="space-y-3">
        <BackLink to="/courses">הקורסים שלי</BackLink>
        {data && <h1 className="text-xl">{data.course.name}</h1>}
        <StudentCourseTabs courseId={courseId} active="polls" />
      </div>
      <ErrorBox>{error}</ErrorBox>
      {!data && !error && <p className="text-center text-ink-3">טוען…</p>}
      <ul className="space-y-3">
        {polls.map((p) => (
          <StudentPollCard key={p.id} p={p} onSaved={replace} />
        ))}
      </ul>
      {data && polls.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2 p-8 text-center text-ink-2">
          אין סקרים עדיין. כשהמרצה יפתח/תפתח סקר, הוא יופיע כאן (ותקבלו התראה אם הפעלתם התראות).
        </div>
      )}
    </div>
  );
}

export default function CoursePolls() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  return user?.role === 'lecturer' ? <LecturerPolls courseId={id} /> : <StudentPolls courseId={id} />;
}
