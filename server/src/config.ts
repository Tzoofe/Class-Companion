const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST !== undefined;

function required(name: string, testDefault: string): string {
  const v = process.env[name];
  if (v) return v;
  if (isTest) return testDefault;
  throw new Error(`Missing env var ${name} — copy server/.env.example to server/.env`);
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  get mongoUri() {
    return required('MONGODB_URI', '');
  },
  get jwtSecret() {
    return required('JWT_SECRET', 'test-secret');
  },
  /** Web Push (VAPID) keys; null when not configured — notifications are then skipped. */
  get vapid() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return null;
    return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT || 'mailto:noreply@example.com' };
  },
  /** Times in exported spreadsheets are shown in this time zone. */
  timeZone: process.env.TIME_ZONE || 'Asia/Jerusalem',
  /**
   * Students may sign up only with these email domains (comma-separated in SIGNUP_EMAIL_DOMAINS).
   * Empty = any domain. Defaults to Ariel University student mail; tests default to any.
   */
  get signupDomains(): string[] {
    const raw = process.env.SIGNUP_EMAIL_DOMAINS ?? (isTest ? '' : 'msmail.ariel.ac.il');
    return raw
      .split(',')
      .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);
  },
  jwtExpiresIn: '7d',
  minPasswordLength: 6,
};
