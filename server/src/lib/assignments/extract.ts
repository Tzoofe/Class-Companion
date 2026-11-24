import path from 'node:path';
import { extractText } from 'unpdf';
import yauzl from 'yauzl';

/** A readable file from a submission. */
export interface ExtractedFile {
  path: string;
  text: string;
  /** Source code (vs. prose), by extension. */
  code: boolean;
}

export const SUBMISSION_LIMITS = {
  uploadBytes: 50 * 1024 * 1024,
  zipEntries: 500,
  zipUncompressedBytes: 80 * 1024 * 1024,
  fileBytes: 2 * 1024 * 1024,
  /** Text kept per submission (enough for review and similarity). */
  totalChars: 400_000,
} as const;

const CODE_EXT = new Set(['.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.c', '.h', '.cpp', '.hpp', '.cc', '.cs', '.go', '.rs', '.rb', '.php', '.kt', '.swift', '.scala', '.m', '.sql', '.sh', '.html', '.css', '.scss', '.vue', '.ipynb', '.r', '.hs', '.asm', '.s']);
const TEXT_EXT = new Set(['.txt', '.md', '.json', '.yml', '.yaml', '.xml', '.csv', '.tex', '.cfg', '.ini', '.toml', '.gradle', '.properties']);
const SKIP_DIRS = ['node_modules/', '.git/', '__MACOSX/', '__pycache__/', 'dist/', 'build/', 'out/', 'target/', 'bin/', 'obj/', '.idea/', '.vscode/', 'venv/', '.venv/', '.next/'];

export class ExtractError extends Error {}

export async function pdfText(data: Uint8Array): Promise<string> {
  try {
    const { text } = await extractText(data, { mergePages: true });
    return text.replace(/[ \t]+\n/g, '\n').trim();
  } catch {
    return ''; // scanned, encrypted or unusual PDFs are still accepted; there's just no text to review
  }
}

/** Jupyter notebooks: keep cell sources only. */
function notebookText(raw: string): string {
  try {
    const nb = JSON.parse(raw) as { cells?: { cell_type?: string; source?: string[] | string }[] };
    return (nb.cells ?? []).map((c) => `# [${c.cell_type}]\n${Array.isArray(c.source) ? c.source.join('') : (c.source ?? '')}`).join('\n\n');
  } catch {
    return raw;
  }
}

function readZip(data: Buffer): Promise<{ name: string; data: Buffer }[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(data, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(new ExtractError('Could not open the ZIP file'));
      const out: { name: string; data: Buffer }[] = [];
      let entries = 0;
      let total = 0;
      zip.on('error', () => reject(new ExtractError('Could not open the ZIP file')));
      zip.on('end', () => resolve(out));
      zip.on('entry', (entry: yauzl.Entry) => {
        entries++;
        const name = entry.fileName.replace(/\\/g, '/');
        const ext = path.extname(name).toLowerCase();
        const wanted =
          !name.endsWith('/') &&
          !SKIP_DIRS.some((d) => name.startsWith(d) || name.includes(`/${d}`)) &&
          !path.basename(name).startsWith('.') &&
          (CODE_EXT.has(ext) || TEXT_EXT.has(ext) || ext === '.pdf') &&
          entry.uncompressedSize <= SUBMISSION_LIMITS.fileBytes;
        if (entries > SUBMISSION_LIMITS.zipEntries) return reject(new ExtractError('The ZIP has too many files'));
        if (!wanted) return zip.readEntry();
        total += entry.uncompressedSize;
        if (total > SUBMISSION_LIMITS.zipUncompressedBytes) return reject(new ExtractError('The ZIP is too large when unpacked'));
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(new ExtractError('Could not open the ZIP file'));
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('error', () => reject(new ExtractError('Could not open the ZIP file')));
          stream.on('end', () => {
            out.push({ name, data: Buffer.concat(chunks) });
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

const looksBinary = (b: Buffer) => b.subarray(0, 4096).includes(0);

/** PDF or ZIP → readable files (text and code). Throws ExtractError with a user-facing reason. */
export async function extractSubmission(fileName: string, data: Buffer): Promise<ExtractedFile[]> {
  const ext = path.extname(fileName).toLowerCase();
  let files: ExtractedFile[] = [];
  if (ext === '.pdf') {
    files = [{ path: path.basename(fileName), text: await pdfText(new Uint8Array(data)), code: false }];
  } else if (ext === '.zip') {
    for (const entry of await readZip(data)) {
      const e = path.extname(entry.name).toLowerCase();
      if (e === '.pdf') {
        const text = await pdfText(new Uint8Array(entry.data)).catch(() => '');
        if (text) files.push({ path: entry.name, text, code: false });
      } else if (!looksBinary(entry.data)) {
        const raw = entry.data.toString('utf8');
        files.push({ path: entry.name, text: e === '.ipynb' ? notebookText(raw) : raw, code: CODE_EXT.has(e) });
      }
    }
  } else {
    throw new ExtractError('Unsupported file type');
  }
  files = files.filter((f) => f.text.trim());
  // Any PDF is accepted: without text (a scan or a photo) it's stored for the lecturer, and the AI review is skipped.
  if (!files.length && ext !== '.pdf') throw new ExtractError('No readable files in the ZIP');

  // Keep the total bounded; the shortest files first so every file is represented.
  let budget: number = SUBMISSION_LIMITS.totalChars;
  const kept = [...files].sort((a, b) => a.text.length - b.text.length).map((f) => {
    const text = f.text.slice(0, Math.max(0, budget));
    budget -= text.length;
    return { ...f, text };
  });
  return kept.filter((f) => f.text).sort((a, b) => a.path.localeCompare(b.path));
}

/** Mostly code? Then the coding model reviews it. */
export const isCodeSubmission = (files: ExtractedFile[]) => {
  const code = files.filter((f) => f.code).reduce((n, f) => n + f.text.length, 0);
  const all = files.reduce((n, f) => n + f.text.length, 0);
  return all > 0 && code / all >= 0.5;
};
