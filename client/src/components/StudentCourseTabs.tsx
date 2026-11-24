import { Link } from 'react-router-dom';

/** Tabs on a student's course pages. */
export default function StudentCourseTabs({ courseId, active }: { courseId: string; active: 'checkin' | 'feed' }) {
  const tab = (key: typeof active, to: string, label: string) => (
    <Link
      to={to}
      aria-current={active === key ? 'page' : undefined}
      className={`flex-1 rounded-md px-3 py-2 text-center text-sm ${active === key ? 'bg-white font-medium shadow-sm' : 'text-slate-600'}`}
    >
      {label}
    </Link>
  );
  return (
    <nav className="flex rounded-lg bg-slate-100 p-1">
      {tab('checkin', `/courses/${courseId}/checkin`, 'נוכחות')}
      {tab('feed', `/courses/${courseId}/feed`, 'שאלות והערות')}
    </nav>
  );
}
