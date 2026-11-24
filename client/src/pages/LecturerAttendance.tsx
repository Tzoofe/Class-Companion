import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ATTENDANCE_RULES } from '../../../shared/attendance';
import { api, ApiError, type CourseSessionsList, type LiveSession, type SessionRoster as Roster, type SessionStatus } from '../api';
import LocationGate, { LocationHelp } from '../components/LocationGate';
import { OpenOnPhoneQr } from '../components/PhoneOnly';
import DotGrid, { DotLegend } from '../components/DotGrid';
import SessionRoster from '../components/SessionRoster';
import { ErrorBox, primaryButton, BackLink } from '../components/ui';
import { isMobileDevice } from '../hooks/useIsMobile';
import { useLocationWatch } from '../hooks/useLocationWatch';

const POLL_MS = 3000;
const MAX_ACC = ATTENDANCE_RULES.lecturerMaxAccuracyM;

/** Waits for a precise location, then lets the lecturer start the session. */
function StartSession({ courseId, onStarted }: { courseId: string; onStarted: (s: LiveSession) => void }) {
  const { recentBest, count, error: geoError, denied } = useLocationWatch(10_000);
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
      <div className="card p-6">
        {recentBest ? (
          <>
            <div className={`text-5xl font-bold ${precise ? 'text-good' : 'text-warn'}`} dir="ltr">
              ±{Math.round(recentBest.accuracy)} m
            </div>
            <p className="mt-3 text-sm text-ink-2">
              {precise ? 'המיקום מדויק מספיק — אפשר להתחיל.' : `ממתין למיקום מדויק… (כרגע: ${Math.round(recentBest.accuracy)} מ׳, נדרש עד ${MAX_ACC} מ׳)`}
            </p>
          </>
        ) : (
          !geoError && <p className="py-4 text-ink-3">מאתר מיקום…</p>
        )}
        <p className="mt-1 text-xs text-ink-4">{count} קריאות</p>
      </div>

      {!precise && !geoError && (
        <p className="rounded-xl bg-surface-2 p-3 text-sm text-ink-2">
          {laptop
            ? 'למחשב נייד אין GPS: המיקום מחושב לפי רשתות Wi-Fi סביבכם ולכן לפעמים פחות מדויק. ודאו שה-Wi-Fi דלוק ושהדפדפן מורשה לגשת למיקום (הגדרות המערכת ← פרטיות ואבטחה ← שירותי מיקום).'
            : 'עמדו בתוך הכיתה, רצוי ליד שולחן המרצה. Wi-Fi דלוק משפר את הדיוק בתוך מבנים.'}
        </p>
      )}
      {denied ? <LocationHelp kind="denied" /> : <ErrorBox>{geoError || error}</ErrorBox>}

      <button type="button" onClick={start} disabled={!precise || busy} className={`${primaryButton} py-4 text-lg`}>
        {busy ? '…' : 'התחל נוכחות'}
      </button>
      <p className="text-xs text-ink-3">
        המפגש יימשך {ATTENDANCE_RULES.defaultSessionMinutes} דקות, וניתן לסגור אותו מוקדם יותר.
      </p>

      {laptop && (
        <details className="card p-4 text-start" open={!!geoError}>
          <summary className="cursor-pointer text-sm font-medium text-ink-2">המיקום במחשב לא מדויק? פתחו את הדף בטלפון</summary>
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

  const [manual, setManual] = useState(0);
  const apply = useCallback((s: SessionStatus | Roster) => {
    setStatus(s);
    // The roster (when it reports in) says who was marked by hand: amber dots.
    if ('students' in s) setManual(s.students.filter((x) => x.present && x.source === 'manual').length);
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

  if (!status) return <p className="text-center text-ink-3">{error || 'טוען…'}</p>;

  const { session, checkedInCount, rosterCount } = status;
  const msLeft = new Date(session.endsAt).getTime() - (now + clockOffset);
  const active = session.status === 'active' && msLeft > 0;

  return (
    <div className="space-y-4">
      <section className="card space-y-5 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className={`flex items-center gap-2 text-sm ${active ? 'text-good' : 'text-ink-3'}`}>
            {active && <span className="h-2 w-2 rounded-full bg-good motion-safe:animate-pulse" />}
            {active ? 'נוכחות פתוחה' : 'המפגש נסגר'}
          </p>
          {active && (
            <p className="font-display text-xl tabular-nums" dir="ltr" aria-label="זמן שנותר">
              {formatLeft(msLeft)}
            </p>
          )}
        </div>
        <DotGrid present={checkedInCount} manual={Math.min(manual, checkedInCount)} total={rosterCount} size="lg" />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="font-display text-5xl tabular-nums">
            {checkedInCount}
            <span className="text-2xl text-ink-3"> מתוך {rosterCount} סטודנטים</span>
            <span className="mt-2 block font-sans text-sm text-ink-3">{active ? 'סימנו נוכחות עד עכשיו' : 'נכחו במפגש'}</span>
          </p>
          <DotLegend withManual={manual > 0} />
        </div>
      </section>

      <p className="text-xs text-ink-3">
        רדיוס {session.radiusM} מ׳ · דיוק נקודת המרכז ±{Math.round(session.centerAccuracyM)} מ׳
      </p>
      <ErrorBox>{error}</ErrorBox>

      {active ? (
        <button type="button" onClick={close} disabled={closing} className="w-full rounded-xl border-2 border-bad/40 bg-surface-2 px-4 py-3 font-medium text-bad disabled:opacity-50">
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
      className="flex items-center justify-between gap-3 card p-4 text-start hover:bg-surface"
    >
      <span>
        <span className="block text-sm font-medium">המפגש האחרון · {lastWhen(last.startsAt)}</span>
        <span className="text-xs text-ink-3">
          {last.present}/{list.rosterCount} נוכחים · אפשר לסמן ולתקן נוכחות גם אחרי שנסגר
        </span>
      </span>
      <span className="shrink-0 text-sm text-accent-ink">עריכה</span>
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
      <BackLink to={`/courses/${id}`}>חזרה לקורס</BackLink>
      <ErrorBox>{error}</ErrorBox>
      {sessionId === undefined && !error && <p className="text-center text-ink-3">טוען…</p>}
      {sessionId === null && (
        <>
          <LocationGate purpose="מרכז הכיתה נקבע לפי המיקום שלך כשאת/ה פותח/ת נוכחות.">
            <StartSession courseId={id} onStarted={(s) => setSessionId(s.id)} />
          </LocationGate>
          <LastSessionLink courseId={id} />
        </>
      )}
      {sessionId && <LiveView sessionId={sessionId} />}
    </div>
  );
}
