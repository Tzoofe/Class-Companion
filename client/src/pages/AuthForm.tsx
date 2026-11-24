import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Field, primaryButton } from '../components/ui';

/** Shared login / signup form. Signup creates student accounts only. */
export default function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const { user, login, signup } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/courses';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [domains, setDomains] = useState<string[]>([]);

  useEffect(() => {
    if (mode === 'signup') api<{ domains: string[] }>('/auth/signup-config').then((r) => setDomains(r.domains), () => {});
  }, [mode]);

  if (user) return <Navigate to={from} replace />;

  const domainOf = (e: string) => e.trim().toLowerCase().split('@')[1] ?? '';
  const wrongDomain = mode === 'signup' && domains.length > 0 && email.includes('@') && domainOf(email) !== '' && !domains.includes(domainOf(email));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await (mode === 'login' ? login : signup)(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isLogin = mode === 'login';
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-6">
      <h1 className="text-2xl text-accent-ink">Class Companion</h1>
      <p className="mb-6 mt-1 text-ink-2">{isLogin ? 'התחברות' : 'הרשמה לסטודנטים'}</p>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field
          label={!isLogin && domains.length ? 'מייל אוניברסיטאי' : 'אימייל'}
          type="email"
          dir="ltr"
          autoComplete="email"
          required
          placeholder={!isLogin && domains.length ? `name@${domains[0]}` : undefined}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {wrongDomain && (
          <p className="-mt-2 text-xs text-warn">
            זה לא מייל אוניברסיטאי. ההרשמה תעבוד רק אם המרצה הוסיף/ה בדיוק את הכתובת הזו לרשימת הקורס.
          </p>
        )}
        <Field
          label="סיסמה"
          type="password"
          dir="ltr"
          autoComplete={isLogin ? 'current-password' : 'new-password'}
          minLength={isLogin ? undefined : 6}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {!isLogin && (
          <p className="text-xs text-ink-3">
            {domains.length ? (
              <>
                הירשמו עם המייל האוניברסיטאי (<span dir="ltr">@{domains[0]}</span>), או עם המייל שהמרצה רשם/ה ברשימת הקורס — כך הקורסים שלכם יופיעו אוטומטית. השם יילקח מהרשימה.
              </>
            ) : (
              'השתמשו באימייל שמופיע ברשימת הקורס. השם יילקח מהרשימה.'
            )}
          </p>
        )}
        <ErrorBox>{error}</ErrorBox>
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? '…' : isLogin ? 'התחברות' : 'הרשמה'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-2">
        {isLogin ? (
          <>
            סטודנט/ית חדש/ה? <Link to="/signup" className="text-accent-ink underline">להרשמה</Link>
          </>
        ) : (
          <>
            כבר רשומים? <Link to="/login" className="text-accent-ink underline">להתחברות</Link>
          </>
        )}
      </p>
    </main>
  );
}
