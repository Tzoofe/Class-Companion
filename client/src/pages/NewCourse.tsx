import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type RosterPreview } from '../api';
import { ErrorBox, Field, primaryButton } from '../components/ui';

const REASON_HE: Record<string, string> = { 'invalid email': 'אימייל לא תקין', 'missing email': 'חסר אימייל' };
const PREVIEW_ROWS = 5;

const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** File → { fileName, fileBase64 } as the API expects. */
async function fileBody(file: File, extra: Record<string, unknown> = {}) {
  if (file.size > MAX_FILE_BYTES) throw new Error('הקובץ גדול מדי (עד 2MB)');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { ...extra, fileName: file.name, fileBase64: btoa(binary) };
}

export default function NewCourse() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [radius, setRadius] = useState('20');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RosterPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onFile(f: File | null) {
    setFile(f);
    setPreview(null);
    setError('');
    if (!f) return;
    setBusy(true);
    try {
      setPreview(await api<RosterPreview>('/courses/preview', { method: 'POST', json: await fileBody(f) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      await api('/courses', { method: 'POST', json: await fileBody(file, { name, defaultRadiusM: Number(radius) }) });
      navigate('/courses');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const canCreate = !!file && !!preview && preview.entries.length > 0 && name.trim() !== '' && !busy;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">קורס חדש</h1>
        <Link to="/courses" className="text-sm text-slate-600 underline">
          ביטול
        </Link>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <Field label="שם הקורס" required value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="רדיוס ברירת מחדל (מטרים)" type="number" min={5} max={500} required dir="ltr" value={radius} onChange={(e) => setRadius(e.target.value)} />

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">רשימת סטודנטים (‎.xlsx או ‎.csv)</span>
          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-indigo-700"
          />
          <span className="mt-1 block text-xs text-slate-500">עמודות: שם פרטי, שם משפחה, דוא״ל</span>
        </label>

        {preview && (
          <div className="space-y-3 rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium">
              נמצאו <span className="text-emerald-700">{preview.entries.length}</span> סטודנטים
              {preview.duplicates > 0 && ` · ${preview.duplicates} כפולים הוסרו`}
              {preview.skipped.length > 0 && <span className="text-amber-700">{` · ${preview.skipped.length} שורות דולגו`}</span>}
            </p>
            {preview.entries.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-start">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-1 text-start font-medium">שם משפחה</th>
                      <th className="py-1 text-start font-medium">שם פרטי</th>
                      <th className="py-1 text-start font-medium">אימייל</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.entries.slice(0, PREVIEW_ROWS).map((r) => (
                      <tr key={r.email} className="border-t border-slate-200">
                        <td className="py-1">{r.lastName}</td>
                        <td className="py-1">{r.firstName}</td>
                        <td className="py-1" dir="ltr">
                          {r.email}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.entries.length > PREVIEW_ROWS && <p className="mt-1 text-slate-500">ועוד {preview.entries.length - PREVIEW_ROWS}…</p>}
              </div>
            )}
            {preview.skipped.length > 0 && (
              <ul className="list-inside list-disc text-amber-800">
                {preview.skipped.map((s) => (
                  <li key={s.row}>
                    שורה {s.row}: {REASON_HE[s.reason] ?? s.reason}
                    {s.value && (
                      <>
                        {' '}(<span dir="ltr">{s.value}</span>)
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <ErrorBox>{error}</ErrorBox>
        <button type="submit" disabled={!canCreate} className={primaryButton}>
          {busy ? '…' : 'צור קורס'}
        </button>
      </form>
    </div>
  );
}
