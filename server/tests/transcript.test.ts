import { describe, expect, it } from 'vitest';
import { chunkTranscript, formatTime, parseCues, parsePlain, parseTimestamp, parseTranscriptFile, parseWhisperJson } from '../src/lib/summaries/transcript';

describe('timestamps', () => {
  it('parses and formats', () => {
    expect(parseTimestamp('01:02:03.500')).toBe(3723.5);
    expect(parseTimestamp('02:03,5')).toBe(123.5);
    expect(parseTimestamp('nope')).toBeNull();
    expect(formatTime(3723.9)).toBe('1:02:03');
    expect(formatTime(65)).toBe('1:05');
  });
});

describe('transcript formats', () => {
  it('reads Zoom WebVTT with speaker lines and tags', () => {
    const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nיעל אברהם: שלום לכולם\n\n2\n00:00:04.500 --> 00:00:08.000\n<v Speaker>היום נדבר על רקורסיה</v>\n';
    expect(parseCues(vtt)).toEqual([
      { start: 1, end: 4, text: 'יעל אברהם: שלום לכולם' },
      { start: 4.5, end: 8, text: 'היום נדבר על רקורסיה' },
    ]);
  });
  it('reads SRT', () => {
    expect(parseCues('1\n00:00:01,000 --> 00:00:02,500\nשורה\nשנייה\n')).toEqual([{ start: 1, end: 2.5, text: 'שורה שנייה' }]);
  });
  it('reads whisper-cli JSON and drops non-speech markers', () => {
    const json = { transcription: [{ offsets: { from: 0, to: 2500 }, text: ' שלום ' }, { offsets: { from: 2500, to: 4000 }, text: '[BLANK_AUDIO]' }] };
    expect(parseWhisperJson(json)).toEqual([{ start: 0, end: 2.5, text: 'שלום' }]);
  });
  it('reads plain text as paragraphs and picks the parser by file name', () => {
    expect(parsePlain('א\n\nב\n')).toEqual([
      { start: 0, end: 0, text: 'א' },
      { start: 0, end: 0, text: 'ב' },
    ]);
    expect(parseTranscriptFile('meet.txt', 'א')).toHaveLength(1);
    expect(parseTranscriptFile('zoom.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nא\n')[0].start).toBe(1);
  });
});

describe('chunkTranscript', () => {
  it('splits between segments and keeps time ranges', () => {
    const segs = Array.from({ length: 10 }, (_, i) => ({ start: i * 10, end: i * 10 + 10, text: 'x'.repeat(30) }));
    const chunks = chunkTranscript(segs, 100);
    expect(chunks.length).toBe(4); // 3 segments (~93 chars) per chunk
    expect(chunks[0]).toMatchObject({ start: 0, end: 30 });
    expect(chunks.at(-1)).toMatchObject({ start: 90, end: 100 });
    expect(chunkTranscript([])).toEqual([]);
  });
});
