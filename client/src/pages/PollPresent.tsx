import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type CoursePolls, type LecturerPoll } from '../api';
import PollResults from '../components/PollResults';

const POLL_MS = 2000;

/** Projector: the open poll (or the last one) with live results and a QR code to answer. */
export default function PollPresent() {
  const { id = '' } = useParams();
  const [data, setData] = useState<CoursePolls<LecturerPoll> | null>(null);
  const [qr, setQr] = useState('');
  const joinUrl = `${window.location.origin}/courses/${id}/polls`;

  useEffect(() => {
    QRCode.toDataURL(joinUrl, { width: 320, margin: 1 }).then(setQr, () => setQr(''));
  }, [joinUrl]);

  useEffect(() => {
    const load = () => api<CoursePolls<LecturerPoll>>(`/courses/${id}/polls`).then(setData, () => {});
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [id]);

  const opened = (data?.polls ?? []).filter((p) => p.openedAt);
  const poll =
    opened.find((p) => p.status === 'open') ??
    [...opened].sort((a, b) => new Date(b.openedAt!).getTime() - new Date(a.openedAt!).getTime())[0];

  return (
    <div className="min-h-dvh bg-slate-900 p-6 text-white lg:p-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <p className="text-lg text-slate-400">
              {data?.course.name}
              {poll && (poll.status === 'open' ? <span className="ms-3 text-emerald-300">● פתוח</span> : <span className="ms-3">הסקר נסגר</span>)}
            </p>
            <Link to={`/courses/${id}/polls`} className="shrink-0 text-sm text-slate-400 hover:text-white">
              יציאה ממסך הקרנה
            </Link>
          </div>
          {poll ? (
            <>
              <h1 className="mt-2 text-4xl font-bold leading-tight lg:text-5xl">{poll.question}</h1>
              <p className="mt-3 text-2xl text-slate-300">
                <span className="font-bold tabular-nums text-white">{poll.results.responses}</span>/{poll.eligible} ענו
                {poll.multiple && <span className="ms-4 text-lg text-slate-400">אפשר לבחור כמה תשובות</span>}
              </p>
              <div className="mt-8">
                <PollResults
                  type={poll.type}
                  options={poll.options}
                  results={poll.results}
                  correctOptionIds={poll.resultsRevealed ? poll.correctOptionIds : []}
                  showTexts={poll.showTextOnScreen}
                  large
                />
              </div>
            </>
          ) : (
            data && <p className="mt-10 text-3xl text-slate-400">אין סקר פתוח כרגע.</p>
          )}
        </div>
        <aside className="shrink-0 text-center lg:w-80">
          {qr && <img src={qr} alt="קוד QR לסקר" className="mx-auto w-64 rounded-xl bg-white p-2 lg:w-72" />}
          <p className="mt-3 text-xl">סרקו כדי לענות</p>
          <p className="mt-1 text-sm text-slate-400">התשובות אנונימיות</p>
        </aside>
      </div>
    </div>
  );
}
