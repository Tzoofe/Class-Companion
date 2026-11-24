import { useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { displayName, useAuth } from '../auth';
import { applyTheme, currentTheme, type Theme } from '../theme';
import { IconLogout, IconMoon, IconSun } from './icons';

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב';
};

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-white">
      {initials || '?'}
    </span>
  );
}

const roundButton =
  'grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-2 text-lg text-ink-2 ring-1 ring-line transition hover:bg-surface-3 hover:text-ink';

/** Sun / moon button: switches between light and dark and remembers the choice. */
function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      title={next === 'light' ? 'מצב בהיר' : 'מצב כהה'}
      aria-label={next === 'light' ? 'מעבר למצב בהיר' : 'מעבר למצב כהה'}
      className={roundButton}
    >
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
    </button>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const name = user ? displayName(user) : '';
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 bg-bg/85 backdrop-blur [padding-top:env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          {user ? (
            <Link to="/courses" className="flex min-w-0 items-center gap-3">
              <Avatar name={name} />
              <span className="min-w-0 leading-tight">
                <span className="block text-xs text-ink-3">{greeting()}</span>
                <span className="block truncate font-semibold">{name}</span>
              </span>
            </Link>
          ) : (
            <Link to="/courses" className="font-bold">
              Class Companion
            </Link>
          )}
          <div className="flex shrink-0 gap-2">
            <ThemeToggle />
            {user && (
              <button type="button" onClick={logout} title="יציאה" aria-label="יציאה" className={roundButton}>
                <IconLogout />
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-4">
        <Outlet />
      </main>
    </div>
  );
}
