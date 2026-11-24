/**
 * Copy detection by overlapping word sequences: two texts are compared by the share of
 * 5-word sequences (shingles) they have in common (Jaccard). Formatting, case and
 * punctuation are ignored, so reformatted or renamed copies still match.
 */
const SHINGLE = 5;

export function shingles(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= words.length; i++) out.add(words.slice(i, i + SHINGLE).join(' '));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let common = 0;
  for (const s of small) if (big.has(s)) common++;
  return common / (a.size + b.size - common);
}

export interface SimilarityInput {
  id: string;
  files: { path: string; text: string }[];
}

export interface SimilarPair {
  a: string;
  b: string;
  score: number;
  /** The most similar file pairs (path in a, path in b, score). */
  files: { a: string; b: string; score: number }[];
}

/** All pairs at or above `threshold`, most similar first. Fine for class sizes (n² over ~60 submissions). */
export function similarPairs(items: SimilarityInput[], threshold = 0.4): SimilarPair[] {
  const whole = items.map((it) => ({ id: it.id, all: shingles(it.files.map((f) => f.text).join(' ')), files: it.files.map((f) => ({ path: f.path, sh: shingles(f.text) })) }));
  const pairs: SimilarPair[] = [];
  for (let i = 0; i < whole.length; i++) {
    for (let j = i + 1; j < whole.length; j++) {
      const score = jaccard(whole[i].all, whole[j].all);
      const fileScores: SimilarPair['files'] = [];
      for (const fa of whole[i].files) for (const fb of whole[j].files) {
        if (fa.sh.size < 10 || fb.sh.size < 10) continue; // ignore tiny files
        const s = jaccard(fa.sh, fb.sh);
        if (s >= threshold) fileScores.push({ a: fa.path, b: fb.path, score: Math.round(s * 100) / 100 });
      }
      const best = Math.max(score, ...fileScores.map((f) => f.score));
      if (best >= threshold) pairs.push({ a: whole[i].id, b: whole[j].id, score: Math.round(best * 100) / 100, files: fileScores.sort((x, y) => y.score - x.score).slice(0, 5) });
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}
