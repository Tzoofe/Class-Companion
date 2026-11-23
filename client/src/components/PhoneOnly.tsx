import QRCode from 'qrcode';
import { useEffect, useState, type ReactNode } from 'react';
import { isMobileDevice } from '../hooks/useIsMobile';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** Renders children on phones; on laptops shows a QR code to open the same page on a phone. */
export default function PhoneOnly({ children }: { children: ReactNode }) {
  const [mobile] = useState(isMobileDevice);
  const [qr, setQr] = useState('');
  const url = window.location.href;

  useEffect(() => {
    if (!mobile) QRCode.toDataURL(url, { width: 240, margin: 1 }).then(setQr, () => setQr(''));
  }, [mobile, url]);

  if (mobile) return <>{children}</>;

  const isLocal = LOCAL_HOSTS.includes(window.location.hostname);
  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
      <h1 className="text-xl font-bold">פתחו את הדף בטלפון</h1>
      <p className="text-sm leading-relaxed text-slate-600">
        מסך הנוכחות עובד רק בטלפון: הוא משתמש ב-GPS של המכשיר כדי לוודא שאתם נמצאים בכיתה, ולמחשב נייד אין GPS מדויק.
      </p>
      <p className="text-sm leading-relaxed text-slate-600">
        <strong>איך?</strong> פתחו את המצלמה בטלפון, כוונו אותה לקוד ה-QR והקישו על הקישור שמופיע — אותו הדף ייפתח בטלפון.
      </p>
      {qr && <img src={qr} alt="קוד QR לפתיחת הדף בטלפון" className="mx-auto h-60 w-60" />}
      <p className="break-all text-xs text-slate-500" dir="ltr">
        {url}
      </p>
      {isLocal && (
        <p className="rounded-lg bg-amber-50 p-3 text-start text-sm text-amber-800">
          הכתובת הנוכחית היא <span dir="ltr">localhost</span>, שהטלפון לא יכול לפתוח. הפעילו את ה-tunnel (ראו{' '}
          <span dir="ltr">docs/PHONE_TESTING.md</span>), פתחו את כתובת ה-<span dir="ltr">https</span> שלו במחשב, ואז סרקו.
        </p>
      )}
    </div>
  );
}
