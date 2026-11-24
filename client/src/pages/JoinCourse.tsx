import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type JoinInfo, type User } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Field, primaryButton } from '../components/ui';

/** Opened from the course QR code: name + email → signed in and on the course roster. No account needed. */
export default function JoinCourse() {
  const { code = '' } = useParams();
  const { user, acceptSession } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<JoinInfo>(`/join/${code}`).then(setInfo, (e) => setLoadError(e.message));
  }, [code]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ token: string; user: User; courseId: string }>(`/join/${code}`, { method: 'POST', json: { firstName, lastName, email, password: password || undefined } });
      acceptSession(r.token, r.user);
      navigate(`/courses/${r.courseId}/checkin`, { replace: true });
    } catch (err) {
      const e2 = err as ApiError;
      if (e2.data?.needsPassword) setNeedsPassword(true);
      setError(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-6">
      <p className="text-sm text-ink-3">Class Companion</p>
      {loadError ? (
        <div className="mt-4 space-y-4">
          <h1 className="text-2xl">הקישור לא פעיל</h1>
          <ErrorBox>{loadError}</ErrorBox>
          <Link to="/login" className="text-sm text-ink-2 underline">
            להתחברות
          </Link>
        </div>
      ) : !info ? (
        <p className="mt-4 text-ink-3">טוען…</p>
      ) : (
        <>
          <h1 className="mt-2 text-3xl leading-tight">הצטרפות ל{info.course.name}</h1>
          {info.course.lecturerName && <p className="mt-1 text-ink-2">{info.course.lecturerName}</p>}
          <form onSubmit={submit} className="mt-8 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="שם פרטי" required value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
              <Field label="שם משפחה" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
            </div>
            <Field
              label="אימייל"
              type="email"
              dir="ltr"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setNeedsPassword(false);
              }}
            />
            <Field
              label={needsPassword ? 'סיסמה של החשבון הקיים' : 'סיסמה (לא חובה)'}
              type="password"
              dir="ltr"
              autoComplete={needsPassword ? 'current-password' : 'new-password'}
              required={needsPassword}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {!needsPassword && <p className="-mt-2 text-xs text-ink-3">בלי סיסמה תישארו מחוברים במכשיר הזה. עם סיסמה אפשר להתחבר גם ממכשיר אחר.</p>}
            <ErrorBox>{error}</ErrorBox>
            <button type="submit" disabled={busy} className={primaryButton}>
              {busy ? '…' : 'הצטרפות'}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
