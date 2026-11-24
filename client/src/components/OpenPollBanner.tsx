import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

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
    <Link to={`/courses/${courseId}/polls`} className="flex items-center justify-between gap-3 rounded-xl bg-indigo-600 p-4 text-white shadow-sm hover:bg-indigo-700">
      <span className="min-w-0">
        <span className="block text-xs font-medium text-indigo-200">📊 סקר פתוח</span>
        <span className="block truncate font-medium">{active.question}</span>
      </span>
      <span className="shrink-0 text-sm">לענות ←</span>
    </Link>
  );
}
