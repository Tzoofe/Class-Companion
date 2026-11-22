import { useState } from 'react';
import { haversineM } from '../../../shared/geo';
import { useLocationWatch, type Reading } from '../hooks/useLocationWatch';

const fmt = (n: number, digits = 1) => n.toFixed(digits);

function accuracyColor(m: number): string {
  if (m <= 30) return 'text-emerald-600';
  if (m <= 100) return 'text-amber-600';
  return 'text-red-600';
}

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span dir="ltr" className={mono ? 'font-mono text-base' : 'text-base'}>
        {value}
      </span>
    </div>
  );
}

export default function DebugLocation() {
  const { latest, best, count, error } = useLocationWatch();
  const [ref, setRef] = useState<Reading | null>(null);

  const distance = latest && ref ? haversineM(latest, ref) : null;
  const secure = window.isSecureContext;

  return (
    <main className="mx-auto max-w-md space-y-4 p-4 pb-10">
      <h1 className="text-xl font-bold">בדיקת דיוק מיקום</h1>

      {!secure && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          הדף לא נטען ב-HTTPS — הדפדפן לא יאפשר גישה למיקום. פתחו דרך כתובת ה-tunnel.
        </p>
      )}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-1 font-semibold">קריאה אחרונה</h2>
        {latest ? (
          <>
            <div className={`py-2 text-center text-4xl font-bold ${accuracyColor(latest.accuracy)}`} dir="ltr">
              ±{fmt(latest.accuracy)} m
            </div>
            <Row label="Latitude" value={fmt(latest.lat, 7)} />
            <Row label="Longitude" value={fmt(latest.lng, 7)} />
            <Row label="זמן" value={new Date(latest.timestamp).toLocaleTimeString('he-IL')} />
            <Row label="מספר קריאות" value={String(count)} />
            {best && <Row label="הדיוק הטוב ביותר" value={`±${fmt(best.accuracy)} m`} />}
          </>
        ) : (
          !error && <p className="py-6 text-center text-slate-500">ממתין למיקום…</p>
        )}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-semibold">נקודת ייחוס</h2>
        <button
          type="button"
          disabled={!best}
          onClick={() => setRef(best)}
          className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white disabled:opacity-40"
        >
          קבע כנקודת ייחוס (הקריאה המדויקת ביותר)
        </button>
        {ref && (
          <>
            <Row label="ייחוס" value={`${fmt(ref.lat, 6)}, ${fmt(ref.lng, 6)}`} />
            <Row label="דיוק הייחוס" value={`±${fmt(ref.accuracy)} m`} />
            {distance !== null && (
              <div className="pt-3 text-center">
                <div className="text-sm text-slate-500">מרחק מנקודת הייחוס</div>
                <div className="text-4xl font-bold" dir="ltr">
                  {fmt(distance)} m
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setRef(null)}
              className="mt-3 w-full rounded-lg border border-slate-300 px-4 py-2 text-sm"
            >
              נקה נקודת ייחוס
            </button>
          </>
        )}
      </section>

      <p className="text-xs text-slate-400">
        ירוק ≤ 30 מ׳ (מספיק לפתיחת נוכחות) · כתום ≤ 100 מ׳ · אדום &gt; 100 מ׳ (נדחה)
      </p>
    </main>
  );
}
