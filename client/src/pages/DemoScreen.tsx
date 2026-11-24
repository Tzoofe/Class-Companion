import QRCode from 'qrcode';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadFile, joinUrl, type JoinStatus } from '../api';
import { ErrorBox } from '../components/ui';

const POLL_MS = 2000;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** One step of the guided demo: what to show, and the button that shows it. */
function Step({ n, title, hint, children }: { n: number; title: string; hint: string; children: ReactNode }) {
  return (
    <li className="flex gap-4 py-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-3 font-display text-sm tabular-nums">{n}</span>
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-sm text-ink-3">{hint}</p>
        </div>
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>
    </li>
  );
}

const btn = 'inline-flex items-center rounded-full bg-surface-2 px-4 py-2 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-surface-3 disabled:opacity-50';
const primary = 'btn-primary inline-flex items-center rounded-full px-4 py-2 text-sm font-medium text-white disabled:opacity-50';

/** Projector screen for a live demo: big QR to join, people appearing as they join, and the demo steps. */
export default function DemoScreen() {
  const { id = '' } = useParams();
  const [status, setStatus] = useState<JoinStatus | null>(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [made, setMade] = useState<{ pollOpened?: boolean; assignmentId?: string }>({});

  useEffect(() => {
    const load = () => api<JoinStatus>(`/courses/${id}/join`).then(setStatus, (e) => setError(e.message));
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [id]);

  const url = status?.joinCode ? joinUrl(status.joinCode) : '';
  useEffect(() => {
    if (url) QRCode.toDataURL(url, { width: 520, margin: 1 }).then(setQr, () => setQr(''));
  }, [url]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const openJoin = () =>
    run('open', async () => {
      await api(`/courses/${id}/join`, { method: 'POST', json: { open: true } });
      setStatus(await api<JoinStatus>(`/courses/${id}/join`));
    });
  const quickPoll = () =>
    run('poll', async () => {
      await api(`/courses/${id}/polls`, {
        method: 'POST',
        json: { question: 'הבנתם את מה שראינו עד עכשיו?', type: 'choice', options: ['כן, הכל ברור', 'בערך', 'לא, צריך הסבר נוסף'], open: true },
      });
      setMade((m) => ({ ...m, pollOpened: true }));
    });
  const demoAssignment = () =>
    run('assignment', async () => {
      const r = await api<{ assignment: { id: string } }>(`/courses/${id}/assignments`, {
        method: 'POST',
        json: {
          title: 'מטלת הדגמה: רקורסיה',
          instructions: 'כתבו פונקציה רקורסיבית שמחשבת עצרת, והסבירו מהו מקרה הבסיס ומה הסיבוכיות. הגישו PDF או ZIP.',
          dueAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          criteria: [
            { id: 'base', title: 'מקרה בסיס נכון', points: 40 },
            { id: 'rec', title: 'צעד רקורסיבי נכון', points: 40 },
            { id: 'cx', title: 'ניתוח סיבוכיות', points: 20 },
          ],
          practiceLimit: 3,
          publish: true,
        },
      });
      setMade((m) => ({ ...m, assignmentId: r.assignment.id }));
    });

  const isLocal = LOCAL_HOSTS.includes(window.location.hostname);
  const joined = status?.joined ?? [];

  return (
    <div className="min-h-dvh bg-bg p-6 text-ink lg:p-10">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[minmax(0,1fr)_26rem]">
        {/* Join: the loud part */}
        <section className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-ink-3">{status?.course.name}</p>
              <h1 className="mt-1 text-4xl lg:text-5xl">סרקו כדי להצטרף</h1>
            </div>
            <Link to={`/courses/${id}`} className="shrink-0 text-sm text-ink-3 hover:text-ink">
              יציאה
            </Link>
          </div>
          <ErrorBox>{error}</ErrorBox>
          {status && !status.joinOpen ? (
            <div className="tile space-y-3 p-6">
              <p>קישור ההצטרפות סגור.</p>
              <button type="button" onClick={openJoin} disabled={busy === 'open'} className={primary}>
                פתיחת קישור הצטרפות
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-6 sm:flex-row">
              {qr && <img src={qr} alt="קוד QR להצטרפות לקורס" className="w-72 shrink-0 rounded-2xl bg-white p-3 lg:w-96" />}
              <div className="min-w-0 space-y-4">
                <p className="text-lg text-ink-2">או היכנסו לכתובת והקלידו את הקוד:</p>
                <p className="break-all text-lg" dir="ltr">
                  {url.replace(/^https?:\/\//, '').replace(/\/join\/.*$/, '/join')}
                </p>
                <p className="font-display text-6xl tracking-[0.15em] tabular-nums" dir="ltr">
                  {status?.joinCode}
                </p>
                {isLocal && (
                  <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">
                    הדף פתוח בכתובת <span dir="ltr">localhost</span>, שטלפונים לא יכולים לפתוח. פתחו את המסך הזה בכתובת הציבורית (Tailscale) כדי שהקוד יעבוד.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="tile p-6">
            <p className="font-display text-5xl tabular-nums">
              {joined.length}
              <span className="text-2xl text-ink-3"> הצטרפו</span>
            </p>
            {joined.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-2">
                {joined.slice(0, 60).map((j, i) => (
                  <li key={`${j.firstName}-${j.joinedAt}`} className={`rounded-full px-3 py-1 text-sm ${i === 0 ? 'bg-accent text-white' : 'bg-surface-2 text-ink-2'}`}>
                    {j.firstName} {j.lastName ? `${j.lastName[0]}׳` : ''}
                  </li>
                ))}
                {joined.length > 60 && <li className="px-2 py-1 text-sm text-ink-3">ועוד {joined.length - 60}</li>}
              </ul>
            )}
          </div>
        </section>

        {/* The demo, step by step */}
        <aside className="tile h-fit p-6">
          <h2 className="text-xl">מה מציגים</h2>
          <ol className="divide-y divide-line">
            <Step n={1} title="נוכחות לפי מיקום" hint="פתחו נוכחות; מי שבחדר לוחץ ״אני כאן״ בטלפון והנקודות מתמלאות.">
              <Link to={`/courses/${id}/attendance`} className={primary}>
                התחלת נוכחות
              </Link>
            </Step>
            <Step n={2} title="סקר בזמן אמת" hint="סקר ״הבנתם?״ נפתח לכולם עם התראה, והתוצאות גדלות על המסך.">
              <button type="button" onClick={quickPoll} disabled={busy === 'poll' || made.pollOpened} className={made.pollOpened ? btn : primary}>
                {made.pollOpened ? 'הסקר פתוח' : 'פתיחת סקר'}
              </button>
              <Link to={`/courses/${id}/polls/present`} className={btn}>
                מסך תוצאות
              </Link>
            </Step>
            <Step n={3} title="שאלות מהקהל" hint="מהטלפון: לשונית ״שאלות״, אפשר באנונימיות. הכי מבוקשות עולות למעלה.">
              <Link to={`/courses/${id}/feed/present`} className={btn}>
                מסך שאלות
              </Link>
            </Step>
            <Step n={4} title="מטלה ובדיקת AI" hint="מטלה עם מועד בעוד 15 דקות; מגישים PDF או ZIP ומקבלים משוב תוך כדקה.">
              {made.assignmentId ? (
                <Link to={`/courses/${id}/assignments/${made.assignmentId}`} className={btn}>
                  למטלה
                </Link>
              ) : (
                <button type="button" onClick={demoAssignment} disabled={busy === 'assignment'} className={primary}>
                  יצירת מטלת הדגמה
                </button>
              )}
            </Step>
            <Step n={5} title="סיכום שיעור" hint="מעלים הקלטה, והסיכום נכתב על המחשב הזה, בלי שירות חיצוני.">
              <Link to={`/courses/${id}/summaries`} className={btn}>
                העלאת הקלטה
              </Link>
            </Step>
            <Step n={6} title="לוח הקורס וייצוא" hint="הנוכחות, השאלות, הסקרים והציונים בלוח אחד, וייצוא לאקסל.">
              <Link to={`/courses/${id}`} className={btn}>
                לוח הקורס
              </Link>
              <button type="button" onClick={() => run('export', () => downloadFile(`/courses/${id}/export`, 'demo.xlsx'))} disabled={busy === 'export'} className={btn}>
                ייצוא
              </button>
            </Step>
          </ol>
        </aside>
      </div>
    </div>
  );
}
