import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type SessionRoster as Roster, type SessionRosterRow, type SessionStatus } from '../api';
import { ErrorBox } from './ui';

const POLL_MS = 3000;
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

function How({ s }: { s: SessionRosterRow }) {
  if (s.present && s.source === 'gps')
    return (
      <span className="text-xs text-ink-3">
        GPS{s.distanceM !== null && ` · ${Math.round(s.distanceM)} מ׳`}
        {s.accuracyM !== null && ` (±${Math.round(s.accuracyM)})`}
        {s.checkedInAt && ` · ${timeOf(s.checkedInAt)}`}
      </span>
    );
  if (s.present) return <span className="text-xs text-accent-ink">סומן ידנית</span>;
  if (s.markedAbsent) return <span className="text-xs text-warn">סומן/ה כלא נוכח/ת</span>;
  if (!s.registered) return <span className="text-xs text-ink-4">לא נרשם/ה לאפליקציה</span>;
  return null;
}

/**
 * The session's roster with a present/absent switch per student.
 * `live` polls for GPS check-ins; `onSummary` receives the updated counts after every load or change.
 */
export default function SessionRoster({ sessionId, live, onSummary }: { sessionId: string; live: boolean; onSummary?: (s: SessionStatus) => void }) {
  const [data, setData] = useState<Roster | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const savingRef = useRef(0);
  const summaryRef = useRef(onSummary);
  summaryRef.current = onSummary;

  const apply = useCallback((r: Roster) => {
    setData(r);
    summaryRef.current?.(r);
  }, []);

  const load = useCallback(
    () =>
      api<Roster>(`/sessions/${sessionId}/roster`)
        // Skip poll results that arrive while a change is being saved, so the switch doesn't flicker back.
        .then((r) => savingRef.current === 0 && apply(r))
        .catch((e) => setError(e.message)),
    [sessionId, apply],
  );

  useEffect(() => {
    load();
    if (!live) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load, live]);

  async function toggle(s: SessionRosterRow) {
    const present = !s.present;
    const key = s.email.toLowerCase();
    setError('');
    savingRef.current++;
    setSaving((prev) => new Set(prev).add(key));
    // Optimistic: flip it now.
    setData((d) => d && { ...d, students: d.students.map((x) => (x.email === s.email ? { ...x, present, markedAbsent: !present, source: present ? 'manual' : null } : x)) });
    try {
      const r = await api<SessionStatus & { student: SessionRosterRow }>(`/sessions/${sessionId}/attendance`, {
        method: 'PUT',
        json: { email: s.email, present },
      });
      setData((d) => d && { ...d, ...r, students: d.students.map((x) => (x.email === s.email ? r.student : x)) });
      summaryRef.current?.(r);
    } catch (e) {
      setError((e as Error).message);
      setData((d) => d && { ...d, students: d.students.map((x) => (x.email === s.email ? s : x)) });
    } finally {
      savingRef.current--;
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  const students = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = data?.students ?? [];
    return q ? all.filter((s) => `${s.firstName} ${s.lastName} ${s.lastName} ${s.firstName} ${s.email}`.toLowerCase().includes(q)) : all;
  }, [data, query]);

  if (!data) return <p className="text-center text-sm text-ink-3">{error || 'טוען רשימה…'}</p>;
  const presentCount = data.students.filter((s) => s.present).length;

  return (
    <section className="space-y-3 text-start">
      <div className="flex items-baseline justify-between">
        <h2 className="">סטודנטים</h2>
        <span className="text-sm tabular-nums text-ink-3">
          {presentCount}/{data.students.length} נוכחים
        </span>
      </div>
      {data.session.status === 'closed' && (
        <p className="rounded-xl bg-surface-2 p-2.5 text-sm text-ink-2">המפגש נסגר — עדיין אפשר לסמן ולתקן נוכחות ידנית.</p>
      )}
      <input
        type="search"
        placeholder="חיפוש לפי שם או אימייל"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-xl border border-line-strong bg-surface-2 px-3 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      />
      <ErrorBox>{error}</ErrorBox>
      <ul className="divide-y divide-line card">
        {students.map((s) => {
          const busy = saving.has(s.email.toLowerCase());
          return (
            <li key={s.email} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {s.firstName} {s.lastName}
                </div>
                <How s={s} />
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={s.present}
                aria-label={`${s.firstName} ${s.lastName}: ${s.present ? 'נוכח/ת' : 'לא נוכח/ת'}`}
                disabled={busy}
                onClick={() => toggle(s)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition disabled:opacity-60 ${
                  s.present ? 'bg-good-strong text-white hover:bg-good-strong' : 'bg-surface-2 text-ink-2 ring-1 ring-line-strong hover:bg-surface-3'
                }`}
              >
                {s.present ? '✓ נוכח/ת' : 'לא נוכח/ת'}
              </button>
            </li>
          );
        })}
        {students.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-3">לא נמצאו סטודנטים</li>}
      </ul>
      {!data.students.some((s) => s.present) && (
        <p className="text-xs text-ink-3">לחצו על סטודנט/ית כדי לסמן נוכחות ידנית. סטודנטים שסימנו ב-GPS יופיעו כאן אוטומטית.</p>
      )}
    </section>
  );
}
