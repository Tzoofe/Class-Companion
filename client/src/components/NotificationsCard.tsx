import { useEffect, useState } from 'react';
import { disablePush, enablePush, getPushState, sendTestPush, type PushState } from '../push';
import { IconBell } from './icons';

const box = 'rounded-2xl p-4 text-sm ring-1';

/** Student opt-in for "attendance is open" notifications on this device. */
export default function NotificationsCard() {
  const [state, setState] = useState<PushState>('loading');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    getPushState().then(setState, () => setState('unsupported'));
  }, []);

  async function run(action: () => Promise<PushState | void>) {
    setBusy(true);
    setNote('');
    try {
      const next = await action();
      if (next) setState(next);
    } catch (e) {
      setNote((e as Error).message || 'משהו השתבש — נסו שוב');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading' || state === 'unsupported') return null;

  if (state === 'needs-install')
    return (
      <div className={`${box} bg-accent-soft text-accent-ink ring-accent/40`}>
        <p className="flex items-center gap-2 font-medium"><IconBell /> רוצים התראה כשהנוכחות נפתחת?</p>
        <p className="mt-1 leading-relaxed">
          באייפון ההתראות עובדות רק מהאפליקציה במסך הבית: בספארי הקישו על <strong>שיתוף</strong> (הריבוע עם החץ) ←{' '}
          <strong>הוספה למסך הבית</strong>, פתחו את האפליקציה משם, התחברו והפעילו התראות.
        </p>
        <p className="mt-1 text-xs text-accent-ink">נדרש iOS 16.4 ומעלה.</p>
      </div>
    );

  if (state === 'unconfigured')
    return <div className={`${box} bg-surface-2 text-ink-2 ring-line`}>התראות עדיין לא הוגדרו בשרת.</div>;

  if (state === 'denied')
    return (
      <div className={`${box} bg-warn-soft text-warn ring-warn/30`}>
        <p className="font-semibold">ההתראות חסומות במכשיר הזה</p>
        <p className="mt-1">כדי לקבל התראה כשהנוכחות נפתחת, אפשרו התראות בהגדרות הטלפון ← התראות ← Class Companion.</p>
      </div>
    );

  if (state === 'on')
    return (
      <div className={`${box} flex flex-wrap items-center justify-between gap-2 bg-good-soft text-good ring-good/30`}>
        <span>✓ תקבלו התראה כשהמרצה פותח נוכחות</span>
        <span className="flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(async () => setNote((await sendTestPush()).sent > 0 ? 'נשלחה התראת בדיקה' : 'לא נמצא מכשיר רשום — כבו והפעילו מחדש'))}
            className="font-medium text-good underline disabled:opacity-50"
          >
            שלח בדיקה
          </button>
          <button type="button" disabled={busy} onClick={() => run(disablePush)} className="text-good underline disabled:opacity-50">
            כבה
          </button>
        </span>
        {note && <p className="w-full text-xs">{note}</p>}
      </div>
    );

  return (
    <div className={`${box} flex flex-wrap items-center justify-between gap-3 bg-surface-2 text-ink-2 ring-line`}>
      <span className="flex items-center gap-2"><IconBell className="text-ink-3" /> קבלו התראה כשהמרצה פותח נוכחות</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => run(enablePush)}
        className="btn-primary rounded-full px-4 py-2 font-medium text-white hover:brightness-110 disabled:opacity-50"
      >
        {busy ? '…' : 'הפעל התראות'}
      </button>
      {note && <p className="w-full text-xs text-bad">{note}</p>}
    </div>
  );
}
