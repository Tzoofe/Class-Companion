import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ATTENDANCE_RULES } from '../../../shared/attendance';
import { api, ApiError, type RangeResult, type StudentActive } from '../api';
import PhoneOnly from '../components/PhoneOnly';
import { ErrorBox } from '../components/ui';
import { useLocationWatch, type Reading } from '../hooks/useLocationWatch';

const NO_SESSION_POLL_MS = 5000;
const RANGE_CHECK_MS = 3000;
const MAX_ACC = ATTENDANCE_RULES.studentMaxAccuracyM;

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

const toBody = (r: Reading) => ({ lat: r.lat, lng: r.lng, accuracy: r.accuracy, timestamp: r.timestamp });

function Done({ checkedInAt }: { checkedInAt: string }) {
  return (
    <div className="rounded-xl bg-emerald-50 p-8 text-center ring-1 ring-emerald-200">
      <div className="text-6xl">✓</div>
      <p className="mt-3 text-xl font-bold text-emerald-800">נוכחותך נרשמה</p>
      <p className="mt-1 text-sm text-emerald-700">בשעה {timeOf(checkedInAt)}</p>
    </div>
  );
}

/** Watches location, asks the server whether we're in range, and shows "I'm here" when we are. */
function CheckInFlow({ sessionId, onDone, onClosed }: { sessionId: string; onDone: (at: string) => void; onClosed: () => void }) {
  const { latest, recentBest, error: geoError } = useLocationWatch(10_000);
  const [range, setRange] = useState<RangeResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lastSent = useRef(0);

  const imprecise = recentBest !== null && recentBest.accuracy > MAX_ACC;

  const handleError = useCallback(
    (e: unknown) => {
      const err = e as ApiError;
      if (err.status === 409 && err.data.error === 'Session is not active') return onClosed();
      if (err.status === 409 && typeof err.data.checkedInAt === 'string') return onDone(err.data.checkedInAt);
      if (err.status === 403 && typeof err.data.distanceM === 'number') {
        setRange({ inRange: false, distanceM: err.data.distanceM, alreadyCheckedIn: false });
      }
      setError(err.message);
    },
    [onClosed, onDone],
  );

  // Ask the server at most every few seconds, using the best reading of the last ~10 s.
  useEffect(() => {
    if (!recentBest || imprecise || Date.now() - lastSent.current < RANGE_CHECK_MS) return;
    lastSent.current = Date.now();
    api<RangeResult>(`/sessions/${sessionId}/range`, { method: 'POST', json: toBody(recentBest) })
      .then((r) => {
        setRange(r);
        setError('');
      })
      .catch(handleError);
  }, [recentBest, imprecise, sessionId, handleError]);

  async function checkIn() {
    // Freshest acceptable reading: the latest one, unless the recent best is better and still fresh.
    const r = recentBest && Date.now() - recentBest.timestamp < 20_000 ? recentBest : latest;
    if (!r) return;
    setBusy(true);
    setError('');
    try {
      const res = await api<{ checkedInAt: string }>(`/sessions/${sessionId}/check-in`, { method: 'POST', json: toBody(r) });
      onDone(res.checkedInAt);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  if (geoError) return <ErrorBox>{geoError}</ErrorBox>;
  if (!recentBest) return <p className="py-10 text-center text-slate-500">מאתר את מיקומך…</p>;

  if (imprecise) {
    return (
      <div className="space-y-3 rounded-xl bg-amber-50 p-6 text-center ring-1 ring-amber-200">
        <p className="text-lg font-semibold text-amber-900">המיקום לא מדויק מספיק</p>
        <p className="text-sm text-amber-800">
          כרגע ±{Math.round(recentBest.accuracy)} מ׳ (נדרש עד {MAX_ACC} מ׳). הפעילו <strong>מיקום מדויק</strong> עבור Safari/Chrome
          בהגדרות הטלפון, והדליקו Wi-Fi.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center">
      {range?.inRange ? (
        <button
          type="button"
          onClick={checkIn}
          disabled={busy}
          className="aspect-square w-full max-w-xs rounded-full bg-emerald-600 text-4xl font-bold text-white shadow-lg transition active:scale-95 disabled:opacity-60"
        >
          {busy ? '…' : 'אני כאן'}
        </button>
      ) : (
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          {range ? (
            <>
              <p className="text-sm text-slate-500">את/ה מחוץ לטווח הכיתה</p>
              <p className="mt-2 text-4xl font-bold" dir="ltr">
                ~{Math.round(range.distanceM)} m
              </p>
              <p className="mt-2 text-sm text-slate-500">מהמרצה. התקרבו לכיתה — הבדיקה ממשיכה אוטומטית.</p>
            </>
          ) : (
            <p className="py-4 text-slate-500">בודק אם את/ה בכיתה…</p>
          )}
        </div>
      )}
      <p className="text-xs text-slate-400" dir="ltr">
        ±{Math.round(recentBest.accuracy)} m
      </p>
      <ErrorBox>{error}</ErrorBox>
    </div>
  );
}

export default function StudentCheckIn() {
  const { id = '' } = useParams();
  const [state, setState] = useState<StudentActive | null>(null);
  const [error, setError] = useState('');
  const [doneAt, setDoneAt] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  const load = useCallback(
    () =>
      api<StudentActive>(`/courses/${id}/sessions/active`)
        .then((s) => {
          setState(s);
          setClosed(false);
          if (s.myCheckIn) setDoneAt(s.myCheckIn.checkedInAt);
        })
        .catch((e) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    load();
  }, [load]);

  // While there is no active session, keep checking so the page updates when the lecturer starts one.
  useEffect(() => {
    if (state && state.session && !closed) return;
    const t = setInterval(load, NO_SESSION_POLL_MS);
    return () => clearInterval(t);
  }, [state, closed, load]);

  const session = closed ? null : state?.session;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Link to="/courses" className="text-sm text-slate-500 hover:underline">
        → הקורסים שלי
      </Link>
      {state && <h1 className="text-xl font-bold">{state.courseName}</h1>}
      <PhoneOnly>
        <ErrorBox>{error}</ErrorBox>
        {!state && !error && <p className="text-center text-slate-500">טוען…</p>}
        {doneAt ? (
          <Done checkedInAt={doneAt} />
        ) : (
          state &&
          (session && state.markedAbsent ? (
            <div className="rounded-xl bg-amber-50 p-6 text-center text-amber-900 ring-1 ring-amber-200">
              <p className="font-semibold">המרצה סימן/ה שלא נכחת במפגש הזה</p>
              <p className="mt-1 text-sm">אם זו טעות, פנו למרצה.</p>
            </div>
          ) : session ? (
            <>
              <p className="text-center text-sm text-slate-500">נוכחות פתוחה עד {timeOf(session.endsAt)}</p>
              <CheckInFlow sessionId={session.id} onDone={setDoneAt} onClosed={() => setClosed(true)} />
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
              {closed ? 'הנוכחות נסגרה.' : 'אין כרגע נוכחות פתוחה בקורס.'}
              <p className="mt-2 text-xs text-slate-400">הדף יתעדכן אוטומטית כשהמרצה יפתח נוכחות.</p>
            </div>
          ))
        )}
      </PhoneOnly>
    </div>
  );
}
