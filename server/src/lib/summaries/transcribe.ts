import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { config } from '../../config.js';
import { parseWhisperJson, type Segment } from './transcript.js';

const run = promisify(execFile);

/** Recording → Hebrew transcript, fully on this machine: ffmpeg (16 kHz mono WAV) then whisper.cpp. */
export type Transcriber = (mediaPath: string) => Promise<Segment[]>;

export const whisperTranscriber: Transcriber = async (mediaPath) => {
  const base = `${mediaPath}.work`;
  const wav = `${base}.wav`;
  try {
    await run(config.ffmpegBin, ['-y', '-loglevel', 'error', '-i', mediaPath, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { maxBuffer: 1 << 20 });
    await run(config.whisper.bin, ['-m', config.whisper.model, '-l', config.whisper.language, '-f', wav, '-oj', '-of', base, '-np'], {
      maxBuffer: 1 << 24,
      timeout: 2 * 60 * 60 * 1000,
    });
    return parseWhisperJson(JSON.parse(await readFile(`${base}.json`, 'utf8')));
  } catch (e) {
    const err = e as { code?: string; stderr?: string; message: string };
    if (err.code === 'ENOENT') throw new Error('Transcription tools are not installed (ffmpeg / whisper-cli)');
    throw new Error(`Transcription failed: ${(err.stderr || err.message).slice(0, 300)}`);
  } finally {
    await Promise.all([rm(wav, { force: true }), rm(`${base}.json`, { force: true })]);
  }
};
