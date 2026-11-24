import { Link } from 'react-router-dom';
import OpenPollBanner from './OpenPollBanner';

type Tab = 'checkin' | 'feed' | 'polls';

/** Tabs on a student's course pages, plus a banner when a poll is waiting for an answer. */
export default function StudentCourseTabs({ courseId, active }: { courseId: string; active: Tab }) {
  const tab = (key: Tab, to: string, label: string) => (
    <Link
      to={to}
      aria-current={active === key ? 'page' : undefined}
      className={`flex-1 rounded-md px-3 py-2 text-center text-sm ${active === key ? 'bg-surface-2 font-medium ' : 'text-ink-2'}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="space-y-3">
      <nav className="flex rounded-xl bg-surface-2 p-1">
        {tab('checkin', `/courses/${courseId}/checkin`, 'נוכחות')}
        {tab('feed', `/courses/${courseId}/feed`, 'שאלות והערות')}
        {tab('polls', `/courses/${courseId}/polls`, 'סקרים')}
      </nav>
      {active !== 'polls' && <OpenPollBanner courseId={courseId} />}
    </div>
  );
}
