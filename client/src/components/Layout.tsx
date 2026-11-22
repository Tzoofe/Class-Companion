import { Link, Outlet } from 'react-router-dom';
import { displayName, useAuth } from '../auth';

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/courses" className="font-bold text-indigo-700">
            Class Companion
          </Link>
          {user && (
            <div className="flex min-w-0 items-center gap-3 text-sm">
              <span className="truncate text-slate-600">
                {displayName(user)} · {user.role === 'lecturer' ? 'מרצה' : 'סטודנט/ית'}
              </span>
              <button type="button" onClick={logout} className="shrink-0 rounded-md border border-slate-300 px-3 py-1">
                יציאה
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-4xl p-4 pb-10">
        <Outlet />
      </main>
    </div>
  );
}
