import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type SessionRoster as Roster, type SessionRosterRow, type SessionStatus } from '../api';
import { ErrorBox } from './ui';

const POLL_MS = 3000;
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

function How({ s }: { s: SessionRosterRow }) {
  if (s.present && s.source === 'gps')
    return (
      <span className="text-xs text-slate-500">
        GPS{s.distanceM !== null && ` · ${Math.round(s.distanceM)} מ׳`}
        {s.checkedInAt && ` · ${timeOf(s.checkedInAt)}`}
      </span>
    );
  if (s.present) return <span className="text-xs text-indigo-700">סומן ידנית</span>;
  if (s.markedAbsent) return <span className="text-xs text-amber-700">סומן/ה כלא נוכח/ת</span>;
  if (!s.registered) return <span className="text-xs text-slate-400">לא נרשם/ה לאפליקציה</span>;
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

  if (!data) return <p className="text-center text-sm text-slate-500">{error || 'טוען רשימה…'}</p>;
  const presentCount = data.students.filter((s) => s.present).length;

  return (
    <section className="space-y-3 text-start">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">סטודנטים</h2>
        <span className="text-sm tabular-nums text-slate-500">
          {presentCount}/{data.students.length} נוכחים
        </span>
      </div>
      <input
        type="search"
        placeholder="חיפוש לפי שם או אימייל"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
      />
      <ErrorBox>{error}</ErrorBox>
      <ul className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
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
                  s.present ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-100 text-slate-600 ring-1 ring-slate-300 hover:bg-slate-200'
                }`}
              >
                {s.present ? '✓ נוכח/ת' : 'לא נוכח/ת'}
              </button>
            </li>
          );
        })}
        {students.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">לא נמצאו סטודנטים</li>}
      </ul>
      {!data.students.some((s) => s.present) && (
        <p className="text-xs text-slate-500">לחצו על סטודנט/ית כדי לסמן נוכחות ידנית. סטודנטים שסימנו ב-GPS יופיעו כאן אוטומטית.</p>
      )}
    </section>
  );
}
