import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { IconPoll } from './icons';

const POLL_MS = 5000;

interface Active {
  poll: { id: string; question: string; answered: boolean; canAnswer: boolean } | null;
}

/** "A poll is open" banner on a student's other course pages, until they answer it. */
export default function OpenPollBanner({ courseId }: { courseId: string }) {
  const [active, setActive] = useState<Active['poll']>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      document.visibilityState === 'visible' &&
      api<Active>(`/courses/${courseId}/polls/active`).then(
        (r) => alive && setActive(r.poll),
        () => {},
      );
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [courseId]);

  if (!active || active.answered || !active.canAnswer) return null;
  return (
    <Link to={`/courses/${courseId}/polls`} className="flex items-center justify-between gap-3 rounded-2xl bg-accent p-4 text-white hover:bg-accent-strong">
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-xs font-medium text-white/80"><IconPoll /> סקר פתוח</span>
        <span className="block truncate font-medium">{active.question}</span>
      </span>
      <span className="shrink-0 text-sm font-medium">לענות</span>
    </Link>
  );
}
