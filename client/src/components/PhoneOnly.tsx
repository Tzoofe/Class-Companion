import QRCode from 'qrcode';
import { useEffect, useState, type ReactNode } from 'react';
import { isMobileDevice } from '../hooks/useIsMobile';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** QR code (plus the raw URL) that opens the current page on a phone. */
export function OpenOnPhoneQr() {
  const [qr, setQr] = useState('');
  const url = window.location.href;

  useEffect(() => {
    QRCode.toDataURL(url, { width: 240, margin: 1 }).then(setQr, () => setQr(''));
  }, [url]);

  const isLocal = LOCAL_HOSTS.includes(window.location.hostname);
  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-ink-2">
        <strong>איך?</strong> פתחו את המצלמה בטלפון, כוונו אותה לקוד ה-QR והקישו על הקישור שמופיע — אותו הדף ייפתח בטלפון.
      </p>
      {qr && <img src={qr} alt="קוד QR לפתיחת הדף בטלפון" className="mx-auto h-60 w-60" />}
      <p className="break-all text-xs text-ink-3" dir="ltr">
        {url}
      </p>
      {isLocal && (
        <p className="rounded-xl bg-warn-soft p-3 text-start text-sm text-warn">
          הכתובת הנוכחית היא <span dir="ltr">localhost</span>, שהטלפון לא יכול לפתוח. הפעילו את ה-tunnel (ראו{' '}
          <span dir="ltr">docs/PHONE_TESTING.md</span>), פתחו את כתובת ה-<span dir="ltr">https</span> שלו במחשב, ואז סרקו.
        </p>
      )}
    </div>
  );
}

/** Renders children on phones; on laptops shows a QR code to open the same page on a phone. */
export default function PhoneOnly({ children }: { children: ReactNode }) {
  const [mobile] = useState(isMobileDevice);
  if (mobile) return <>{children}</>;

  return (
    <div className="mx-auto max-w-md space-y-4 card p-6 text-center">
      <h1 className="text-xl">פתחו את הדף בטלפון</h1>
      <p className="text-sm leading-relaxed text-ink-2">
        מסך הנוכחות עובד רק בטלפון: הוא משתמש ב-GPS של המכשיר כדי לוודא שאתם נמצאים בכיתה, ולמחשב נייד אין GPS מדויק.
      </p>
      <OpenOnPhoneQr />
    </div>
  );
}
