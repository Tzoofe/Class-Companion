import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokenStore, type User } from './api';
import { disablePush } from './push';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (email: string, password: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => tokenStore.get() !== null);

  useEffect(() => {
    if (!tokenStore.get()) return;
    api<{ user: User }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => tokenStore.set(null))
      .finally(() => setLoading(false));
  }, []);

  const authenticate = useCallback(async (path: string, email: string, password: string) => {
    const r = await api<{ token: string; user: User }>(path, { method: 'POST', json: { email, password } });
    tokenStore.set(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const value: AuthState = {
    user,
    loading,
    login: (e, p) => authenticate('/auth/login', e, p),
    signup: (e, p) => authenticate('/auth/signup', e, p),
    logout: () => {
      // Stop notifications for this account on this device (best effort, needs the token, so before clearing it).
      void disablePush().catch(() => {});
      tokenStore.set(null);
      setUser(null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const displayName = (u: Pick<User, 'firstName' | 'lastName' | 'email'>) =>
  `${u.firstName} ${u.lastName}`.trim() || u.email;
