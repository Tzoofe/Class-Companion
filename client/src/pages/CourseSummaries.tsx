import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, isProcessing, uploadFile, type LessonSummaryView, type SummaryStatus } from '../api';
import { useAuth } from '../auth';
import { TextLink } from '../components/Bento';
import StudentCourseTabs from '../components/StudentCourseTabs';
import { BackLink, ErrorBox, pillButton } from '../components/ui';

const POLL_MS = 3000;

export const STATUS_HE: Record<SummaryStatus, string> = {
  queued: 'ממתין בתור',
  transcribing: 'מתמלל את ההקלטה',
  summarizing: 'כותב סיכום',
  draft: 'טיוטה, רק את/ה רואה',
  published: 'פורסם לסטודנטים',
  failed: 'נכשל',
};

export const fmtDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function UploadForm({ courseId, onUploaded }: { courseId: string; onUploaded: (s: LessonSummaryView) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState(today);
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError('');
    setProgress(0);
    try {
      const q = new URLSearchParams({ fileName: file.name, date, title });
      const r = await uploadFile<{ summary: LessonSummaryView }>(`/courses/${courseId}/summaries?${q}`, file, setProgress);
      onUploaded(r.summary);
      setFile(null);
      setTitle('');
      if (input.current) input.current.value = '';
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
    }
  }

  const field = 'w-full rounded-xl border border-line-strong bg-surface-2 px-3 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
  return (
    <form onSubmit={submit} className="tile space-y-4 p-6">
      <div>
        <h2 className="text-lg">סיכום שיעור חדש</h2>
        <p className="mt-1 text-sm text-ink-3">
          העלו הקלטה של השיעור (mp4, m4a, mp3…) או קובץ תמלול מזום (vtt). התמלול והסיכום נעשים על המחשב הזה, בלי שירות חיצוני, ולוקחים כמה דקות.
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept=".mp4,.m4a,.mp3,.wav,.webm,.mov,.aac,.ogg,.mkv,.vtt,.srt,.txt,audio/*,video/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm file:me-3 file:rounded-full file:border-0 file:bg-surface-3 file:px-4 file:py-2 file:text-ink"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-ink-2">תאריך השיעור</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} required />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-2">כותרת (לא חובה)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="למשל: רקורסיה" className={field} />
        </label>
      </div>
      {progress !== null && (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="mt-1 text-xs text-ink-3">מעלה… {Math.round(progress * 100)}%</p>
        </div>
      )}
      <ErrorBox>{error}</ErrorBox>
      <button type="submit" disabled={!file || progress !== null} className={pillButton}>
        העלאה וסיכום
      </button>
    </form>
  );
}

function Row({ s, courseId, lecturer }: { s: LessonSummaryView; courseId: string; lecturer: boolean }) {
  const busy = isProcessing(s);
  return (
    <li>
      <Link to={`/courses/${courseId}/summaries/${s.id}`} className="block py-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-lg">{s.title || fmtDate(s.date)}</span>
          {lecturer && <span className={`shrink-0 text-sm ${s.status === 'failed' ? 'text-bad' : s.status === 'published' ? 'text-good' : 'text-ink-3'}`}>{STATUS_HE[s.status]}</span>}
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm text-ink-3">{busy ? `${fmtDate(s.date)}, ${s.progress}%` : s.content.overview || fmtDate(s.date)}</p>
        {busy && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(3, s.progress)}%` }} />
          </div>
        )}
      </Link>
    </li>
  );
}

/** Lesson summaries of a course: lecturer uploads and manages; students read the published ones. */
export default function CourseSummaries() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const lecturer = user?.role === 'lecturer';
  const [data, setData] = useState<{ course: { id: string; name: string }; summaries: LessonSummaryView[] } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => api<NonNullable<typeof data>>(`/courses/${id}/summaries`).then(setData, (e) => setError(e.message)), [id]);
  const working = data?.summaries.some(isProcessing) ?? false;

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [working, load]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {lecturer ? (
        <div>
          <BackLink to={`/courses/${id}`}>{data?.course.name ?? 'חזרה לקורס'}</BackLink>
          <h1 className="mt-2 text-3xl">סיכומי שיעורים</h1>
        </div>
      ) : (
        <div className="space-y-3">
          <BackLink to="/courses">הקורסים שלי</BackLink>
          {data && <h1 className="text-2xl">{data.course.name}</h1>}
          <StudentCourseTabs courseId={id} active="summaries" />
        </div>
      )}

      <ErrorBox>{error}</ErrorBox>
      {lecturer && <UploadForm courseId={id} onUploaded={(s) => setData((d) => d && { ...d, summaries: [s, ...d.summaries] })} />}

      {data && (
        <section className="tile p-6">
          <h2 className="text-lg">{lecturer ? 'כל הסיכומים' : 'סיכומי שיעורים'}</h2>
          {data.summaries.length ? (
            <ul className="mt-2 divide-y divide-line">
              {data.summaries.map((s) => (
                <Row key={s.id} s={s} courseId={id} lecturer={lecturer} />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-ink-2">{lecturer ? 'עוד לא הועלו שיעורים.' : 'עוד לא פורסמו סיכומים. כשהמרצה יפרסם/תפרסם סיכום, תקבלו התראה.'}</p>
          )}
        </section>
      )}
      {lecturer && <p className="text-xs text-ink-3">הסיכום נכתב אוטומטית ועלול לטעות, במיוחד במונחים מקצועיים. בדקו ותקנו לפני הפרסום.</p>}
      {!lecturer && <TextLink to={`/courses/${id}/checkin`}>לנוכחות</TextLink>}
    </div>
  );
}
