/** A piece of transcript with start/end in seconds from the start of the recording. */
export interface Segment {
  start: number;
  end: number;
  text: string;
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

/** "01:02:03.500", "02:03,5" → seconds. */
export function parseTimestamp(s: string): number | null {
  const m = TIME.exec(s);
  if (!m) return null;
  const [, h, min, sec, frac] = m;
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec) + Number(frac.padEnd(3, '0')) / 1000;
}

/** Seconds → "1:02:03" or "2:03". */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** WebVTT (Zoom transcripts) and SRT: cue blocks of "start --> end" followed by text lines. */
export function parseCues(text: string): Segment[] {
  const segments: Segment[] = [];
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const [a, b] = lines[timeIdx].split('-->');
    const start = parseTimestamp(a);
    const end = parseTimestamp(b);
    const body = lines
      .slice(timeIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '') // VTT voice/style tags
      .trim();
    if (start === null || end === null || !body) continue;
    segments.push({ start, end, text: body });
  }
  return segments;
}

/** whisper-cli --output-json: { transcription: [{ offsets: { from, to } (ms), text }] }. */
export function parseWhisperJson(json: unknown): Segment[] {
  const items = (json as { transcription?: { offsets?: { from: number; to: number }; text?: string }[] })?.transcription ?? [];
  return items
    .map((t) => ({ start: (t.offsets?.from ?? 0) / 1000, end: (t.offsets?.to ?? 0) / 1000, text: (t.text ?? '').trim() }))
    .filter((s) => s.text && !/^\[.*\]$/.test(s.text)); // drop "[BLANK_AUDIO]" and similar
}

/** Plain text (e.g. a Meet transcript saved as .txt): no timestamps, one segment per paragraph. */
export function parsePlain(text: string): Segment[] {
  return text
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ start: 0, end: 0, text: t }));
}

export const TRANSCRIPT_EXTENSIONS = ['.vtt', '.srt', '.txt'] as const;

export function parseTranscriptFile(fileName: string, content: string): Segment[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.vtt') || lower.endsWith('.srt') || content.includes('-->')) return parseCues(content);
  return parsePlain(content);
}

export interface Chunk {
  start: number;
  end: number;
  text: string;
}

/**
 * Splits a transcript into chunks a small local model can read in one go (about `maxChars` each),
 * breaking only between segments. Each chunk keeps its time range for the topic timestamps.
 */
export function chunkTranscript(segments: Segment[], maxChars = 6000): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Segment[] = [];
  let size = 0;
  const flush = () => {
    if (!cur.length) return;
    chunks.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((s) => s.text).join(' ') });
    cur = [];
    size = 0;
  };
  for (const s of segments) {
    if (size + s.text.length > maxChars && cur.length) flush();
    cur.push(s);
    size += s.text.length + 1;
  }
  flush();
  return chunks;
}

export const transcriptText = (segments: Segment[]) => segments.map((s) => s.text).join(' ');
