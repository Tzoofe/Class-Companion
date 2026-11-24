import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import type { User } from '../api';

/** Renders child routes only for a logged-in user (optionally of a given role). */
export default function RequireAuth({ role }: { role?: User['role'] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="p-6 text-center text-ink-3">טוען…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (role && user.role !== role) return <Navigate to="/courses" replace />;
  return <Outlet />;
}
