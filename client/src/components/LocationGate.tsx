import { useEffect, useState, type ReactNode } from 'react';
import { isIOS, isStandalone } from '../push';

/** Accuracy worse than this almost always means "Precise Location" is off (the phone reports a ~km area). */
export const APPROXIMATE_LOCATION_M = 1000;

const isAndroid = () => /Android/i.test(navigator.userAgent);
const isIOSChrome = () => /CriOS/.test(navigator.userAgent);

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mt-2 list-decimal space-y-1 ps-5 text-start text-sm leading-relaxed">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ol>
  );
}

/** Platform-specific steps for allowing location or turning on Precise Location. */
export function LocationHelp({ kind }: { kind: 'denied' | 'approximate' }) {
  const title = kind === 'denied' ? 'הגישה למיקום חסומה' : 'מיקום מדויק כבוי';
  let steps: ReactNode[];
  if (isIOS() && isIOSChrome()) {
    steps = [
      <>
        <strong>הגדרות</strong> ← <strong>פרטיות ואבטחה</strong> ← <strong>שירותי מיקום</strong> — ודאו שמופעל.
      </>,
      <>
        באותו מסך: <strong>Chrome</strong> ← <strong>בזמן השימוש ביישום</strong>, והפעילו <strong>מיקום מדויק</strong>.
      </>,
      'חזרו לכאן ורעננו את הדף.',
    ];
  } else if (isIOS()) {
    steps = [
      <>
        <strong>הגדרות</strong> ← <strong>פרטיות ואבטחה</strong> ← <strong>שירותי מיקום</strong> — ודאו שמופעל.
      </>,
      <>
        גללו ל-<strong>אתרי Safari</strong> ← בחרו <strong>בזמן השימוש ביישום</strong> והפעילו <strong>מיקום מדויק</strong>
        {isStandalone() ? ' (ההגדרה הזו חלה גם על האפליקציה ממסך הבית).' : '.'}
      </>,
      isStandalone() ? 'סגרו את האפליקציה לגמרי ופתחו אותה מחדש.' : (
        <>
          אם עדיין חסום: בספארי הקישו על <strong>aA</strong> בשורת הכתובת ← <strong>הגדרות אתר</strong> ← <strong>מיקום</strong> ← <strong>אפשר</strong>, ורעננו.
        </>
      ),
    ];
  } else if (isAndroid()) {
    steps = [
      <>
        ודאו ש<strong>מיקום</strong> מופעל בטלפון (משיכה מלמעלה ← מיקום).
      </>,
      <>
        <strong>הגדרות</strong> ← <strong>אפליקציות</strong> ← <strong>Chrome</strong> ← <strong>הרשאות</strong> ← <strong>מיקום</strong> ← "רק בזמן השימוש", והפעילו <strong>מיקום מדויק</strong>.
      </>,
      kind === 'denied' ? (
        <>
          ב-Chrome: הקישו על סמל האתר משמאל לכתובת ← <strong>הרשאות</strong> ← <strong>מיקום</strong> ← <strong>אפשר</strong>, ורעננו.
        </>
      ) : (
        'חזרו לכאן ורעננו את הדף.'
      ),
    ];
  } else {
    steps = ['אפשרו גישה למיקום לאתר הזה בהגדרות הדפדפן (סמל המנעול ליד הכתובת), ורעננו את הדף.'];
  }
  return (
    <div className="rounded-xl bg-amber-50 p-5 text-amber-900 ring-1 ring-amber-200">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-1 text-sm">
        {kind === 'denied'
          ? 'הטלפון לא מאפשר לאתר לקבל מיקום, ולכן לא מופיעה בקשת הרשאה. כך מאפשרים:'
          : 'הטלפון שולח רק מיקום משוער (בטווח של קילומטרים). כך מפעילים מיקום מדויק:'}
      </p>
      <Steps items={steps} />
    </div>
  );
}

type Permission = 'checking' | 'prompt' | 'granted' | 'denied';

/**
 * Asks for location from a tap (browsers may silently refuse requests made on page load) and shows
 * how to fix it when access is blocked. Renders `children` — which start watching — once allowed.
 */
export default function LocationGate({ children, purpose }: { children: ReactNode; purpose: string }) {
  const [permission, setPermission] = useState<Permission>('checking');
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let status: PermissionStatus | null = null;
    const onChange = () => status && setPermission(status.state as Permission);
    if (!('geolocation' in navigator)) {
      setPermission('denied');
      return;
    }
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((s) => {
        status = s;
        setPermission(s.state as Permission);
        s.addEventListener('change', onChange);
      })
      .catch(() => setPermission('prompt'));
    if (!navigator.permissions) setPermission('prompt');
    return () => status?.removeEventListener('change', onChange);
  }, []);

  function ask() {
    setAsking(true);
    // Called directly from the tap, so the browser shows its permission prompt.
    navigator.geolocation.getCurrentPosition(
      () => setPermission('granted'),
      (err) => {
        setAsking(false);
        // Timeouts / no fix: access itself is fine, let the page keep trying.
        setPermission(err.code === 1 ? 'denied' : 'granted');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  if (permission === 'granted') return <>{children}</>;
  if (permission === 'checking') return <p className="py-10 text-center text-slate-500">בודק הרשאת מיקום…</p>;
  if (permission === 'denied') return <LocationHelp kind="denied" />;
  return (
    <div className="space-y-4 rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
      <p className="text-4xl">📍</p>
      <p className="text-sm leading-relaxed text-slate-600">{purpose}</p>
      <button
        type="button"
        onClick={ask}
        disabled={asking}
        className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {asking ? 'ממתין לאישור…' : 'אפשרו גישה למיקום'}
      </button>
      <p className="text-xs text-slate-500">בחלון שייפתח בחרו "אפשר" (ובאייפון השאירו "מיקום מדויק" מופעל).</p>
    </div>
  );
}
