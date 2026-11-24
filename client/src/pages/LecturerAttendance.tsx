import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ATTENDANCE_RULES } from '../../../shared/attendance';
import { api, ApiError, type CourseSessionsList, type LiveSession, type SessionStatus } from '../api';
import { OpenOnPhoneQr } from '../components/PhoneOnly';
import SessionRoster from '../components/SessionRoster';
import { ErrorBox, primaryButton } from '../components/ui';
import { isMobileDevice } from '../hooks/useIsMobile';
import { useLocationWatch } from '../hooks/useLocationWatch';

const POLL_MS = 3000;
const MAX_ACC = ATTENDANCE_RULES.lecturerMaxAccuracyM;

/** Waits for a precise location, then lets the lecturer start the session. */
function StartSession({ courseId, onStarted }: { courseId: string; onStarted: (s: LiveSession) => void }) {
  const { recentBest, count, error: geoError } = useLocationWatch(10_000);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [laptop] = useState(() => !isMobileDevice());
  const precise = recentBest !== null && recentBest.accuracy <= MAX_ACC;

  async function start() {
    if (!recentBest) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ session: LiveSession }>(`/courses/${courseId}/sessions`, {
        method: 'POST',
        json: { lat: recentBest.lat, lng: recentBest.lng, accuracy: recentBest.accuracy },
      });
      onStarted(r.session);
    } catch (e) {
      const err = e as ApiError;
      // Someone (e.g. another device) already started one: just show it.
      if (err.status === 409 && err.data.session) return onStarted(err.data.session as LiveSession);
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 text-center">
      <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        {recentBest ? (
          <>
            <div className={`text-5xl font-bold ${precise ? 'text-emerald-600' : 'text-amber-600'}`} dir="ltr">
              ±{Math.round(recentBest.accuracy)} m
            </div>
            <p className="mt-3 text-sm text-slate-600">
              {precise ? 'המיקום מדויק מספיק — אפשר להתחיל.' : `ממתין למיקום מדויק… (כרגע: ${Math.round(recentBest.accuracy)} מ׳, נדרש עד ${MAX_ACC} מ׳)`}
            </p>
          </>
        ) : (
          !geoError && <p className="py-4 text-slate-500">מאתר מיקום…</p>
        )}
        <p className="mt-1 text-xs text-slate-400">{count} קריאות</p>
      </div>

      {!precise && !geoError && (
        <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">
          {laptop
            ? 'למחשב נייד אין GPS: המיקום מחושב לפי רשתות Wi-Fi סביבכם ולכן לפעמים פחות מדויק. ודאו שה-Wi-Fi דלוק ושהדפדפן מורשה לגשת למיקום (הגדרות המערכת ← פרטיות ואבטחה ← שירותי מיקום).'
            : 'עמדו בתוך הכיתה, רצוי ליד שולחן המרצה. Wi-Fi דלוק משפר את הדיוק בתוך מבנים.'}
        </p>
      )}
      <ErrorBox>{geoError || error}</ErrorBox>

      <button type="button" onClick={start} disabled={!precise || busy} className={`${primaryButton} py-4 text-lg`}>
        {busy ? '…' : 'התחל נוכחות'}
      </button>
      <p className="text-xs text-slate-500">
        המפגש יימשך {ATTENDANCE_RULES.defaultSessionMinutes} דקות, וניתן לסגור אותו מוקדם יותר.
      </p>

      {laptop && (
        <details className="rounded-xl bg-white p-4 text-start shadow-sm ring-1 ring-slate-200" open={!!geoError}>
          <summary className="cursor-pointer text-sm font-medium text-slate-700">המיקום במחשב לא מדויק? פתחו את הדף בטלפון</summary>
          <div className="mt-3 text-center">
            <OpenOnPhoneQr />
          </div>
        </details>
      )}
    </div>
  );
}

function formatLeft(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Live counter (polled) + countdown + close. */
function LiveView({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [clockOffset, setClockOffset] = useState(0); // serverNow − deviceNow
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);

  const apply = useCallback((s: SessionStatus) => {
    setStatus(s);
    setClockOffset(new Date(s.serverNow).getTime() - Date.now());
    setError('');
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<SessionStatus>(`/sessions/${sessionId}`)
        .then((s) => alive && apply(s))
        .catch((e) => alive && setError(e.message));
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [sessionId, apply]);

  async function close() {
    if (!window.confirm('לסגור את הנוכחות עכשיו? סטודנטים לא יוכלו עוד לסמן נוכחות.')) return;
    setClosing(true);
    try {
      apply(await api<SessionStatus>(`/sessions/${sessionId}/close`, { method: 'POST' }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setClosing(false);
    }
  }

  if (!status) return <p className="text-center text-slate-500">{error || 'טוען…'}</p>;

  const { session, checkedInCount, rosterCount } = status;
  const msLeft = new Date(session.endsAt).getTime() - (now + clockOffset);
  const active = session.status === 'active' && msLeft > 0;

  return (
    <div className="space-y-4 text-center">
      <div className={`rounded-xl p-6 shadow-sm ring-1 ${active ? 'bg-white ring-emerald-200' : 'bg-slate-100 ring-slate-200'}`}>
        <p className={`text-sm font-medium ${active ? 'text-emerald-700' : 'text-slate-600'}`}>
          {active ? '● נוכחות פעילה' : 'המפגש נסגר'}
        </p>
        <div className="mt-2 text-6xl font-bold tabular-nums" dir="ltr">
          {checkedInCount}
          <span className="text-3xl text-slate-400">/{rosterCount}</span>
        </div>
        <p className="mt-1 text-sm text-slate-500">סימנו נוכחות</p>
        {active && (
          <p className="mt-4 text-lg tabular-nums" dir="ltr">
            ⏱ {formatLeft(msLeft)}
          </p>
        )}
      </div>

      <p className="text-xs text-slate-500">
        רדיוס {session.radiusM} מ׳ · דיוק נקודת המרכז ±{Math.round(session.centerAccuracyM)} מ׳
      </p>
      <ErrorBox>{error}</ErrorBox>

      {active ? (
        <button type="button" onClick={close} disabled={closing} className="w-full rounded-lg border-2 border-red-300 bg-white px-4 py-3 font-medium text-red-700 disabled:opacity-50">
          {closing ? '…' : 'סגור נוכחות'}
        </button>
      ) : (
        <Link to={`/courses/${session.courseId}`} className={`${primaryButton} block`}>
          חזרה ללוח הקורס
        </Link>
      )}

      <div className="pt-2">
        <SessionRoster sessionId={sessionId} live={active} onSummary={apply} />
      </div>
    </div>
  );
}

const lastWhen = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

/** When no session is open: a way back to the latest (closed) session to fix its attendance. */
function LastSessionLink({ courseId }: { courseId: string }) {
  const [list, setList] = useState<CourseSessionsList | null>(null);
  useEffect(() => {
    api<CourseSessionsList>(`/courses/${courseId}/sessions`).then(setList, () => setList(null));
  }, [courseId]);
  const last = list?.sessions[0];
  if (!last) return null;
  return (
    <Link
      to={`/courses/${courseId}/sessions/${last.id}`}
      className="flex items-center justify-between gap-3 rounded-xl bg-white p-4 text-start shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
    >
      <span>
        <span className="block text-sm font-medium">המפגש האחרון · {lastWhen(last.startsAt)}</span>
        <span className="text-xs text-slate-500">
          {last.present}/{list.rosterCount} נוכחים · אפשר לסמן ולתקן נוכחות גם אחרי שנסגר
        </span>
      </span>
      <span className="shrink-0 text-sm text-indigo-700">עריכה ←</span>
    </Link>
  );
}

export default function LecturerAttendance() {
  const { id = '' } = useParams();
  const [sessionId, setSessionId] = useState<string | null | undefined>(undefined); // undefined = loading
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ session: LiveSession | null }>(`/courses/${id}/sessions/active`)
      .then((r) => setSessionId(r.session?.id ?? null))
      .catch((e) => setError(e.message));
  }, [id]);

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Link to={`/courses/${id}`} className="text-sm text-slate-500 hover:underline">
        → חזרה לקורס
      </Link>
      <ErrorBox>{error}</ErrorBox>
      {sessionId === undefined && !error && <p className="text-center text-slate-500">טוען…</p>}
      {sessionId === null && (
        <>
          <StartSession courseId={id} onStarted={(s) => setSessionId(s.id)} />
          <LastSessionLink courseId={id} />
        </>
      )}
      {sessionId && <LiveView sessionId={sessionId} />}
    </div>
  );
}
