import { Link } from 'react-router-dom';
import OpenPollBanner from './OpenPollBanner';

type Tab = 'checkin' | 'feed' | 'polls' | 'assignments' | 'summaries';

const TABS: [Tab, string, string][] = [
  ['checkin', 'checkin', 'נוכחות'],
  ['feed', 'feed', 'שאלות'],
  ['polls', 'polls', 'סקרים'],
  ['assignments', 'assignments', 'מטלות'],
  ['summaries', 'summaries', 'סיכומים'],
];

/** Tabs on a student's course pages (scroll sideways on narrow phones), plus the open-poll banner. */
export default function StudentCourseTabs({ courseId, active }: { courseId: string; active: Tab }) {
  return (
    <div className="space-y-3">
      <nav className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1">
        {TABS.map(([key, path, label]) => (
          <Link
            key={key}
            to={`/courses/${courseId}/${path}`}
            aria-current={active === key ? 'page' : undefined}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-center text-sm transition-colors ${
              active === key ? 'bg-surface font-medium text-ink shadow-sm' : 'text-ink-3 hover:text-ink'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {active !== 'polls' && <OpenPollBanner courseId={courseId} />}
    </div>
  );
}
