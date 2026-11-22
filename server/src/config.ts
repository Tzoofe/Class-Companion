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
  jwtExpiresIn: '7d',
  minPasswordLength: 6,
};
