import { describe, expect, it } from 'vitest';
import { extractSubmission, isCodeSubmission } from '../src/lib/assignments/extract';
import { normalizeReview, reviewSchema, submissionText } from '../src/lib/assignments/review';
import { jaccard, shingles, similarPairs } from '../src/lib/assignments/similarity';
import { makePdf, makeZip } from './fixtures';

describe('extractSubmission', () => {
  it('reads PDF text', async () => {
    const files = await extractSubmission('hw1.pdf', makePdf('The base case is n equals zero'));
    expect(files).toEqual([{ path: 'hw1.pdf', text: expect.stringContaining('base case'), code: false }]);
  });

  it('accepts any PDF (no text → no files), rejects unsupported types', async () => {
    expect(await extractSubmission('scan.pdf', makePdf(''))).toEqual([]);
    expect(await extractSubmission('broken.pdf', Buffer.from('%PDF-1.4 garbage'))).toEqual([]);
    await expect(extractSubmission('x.docx', Buffer.from('x'))).rejects.toThrow('Unsupported file type');
    await expect(extractSubmission('bad.zip', Buffer.from('not a zip'))).rejects.toThrow('Could not open the ZIP file');
  });

  it('reads code and text from a ZIP, skipping junk folders, binaries and hidden files', async () => {
    const zip = makeZip({
      'hw/main.py': 'def fact(n):\n    return 1 if n == 0 else n * fact(n - 1)\n',
      'hw/README.md': 'הסבר קצר',
      'hw/node_modules/lib/index.js': 'junk',
      'hw/__MACOSX/._main.py': 'junk',
      'hw/.env': 'SECRET=1',
      'hw/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]),
      'hw/data.bin': Buffer.from([1, 0, 2, 0]),
      'hw/report.pdf': makePdf('Complexity is O of n'),
    });
    const files = await extractSubmission('hw.zip', zip);
    expect(files.map((f) => f.path)).toEqual(['hw/main.py', 'hw/README.md', 'hw/report.pdf']);
    expect(files.find((f) => f.path === 'hw/main.py')!.code).toBe(true);
    expect(isCodeSubmission(files)).toBe(true);
  });

  it('refuses ZIPs with too many files', async () => {
    const many = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`f${i}.txt`, 'x']));
    await expect(extractSubmission('many.zip', makeZip(many))).rejects.toThrow('too many files');
  });
});

describe('similarity', () => {
  const original = 'def fact(n):\n  if n == 0:\n    return 1\n  return n * fact(n - 1)\n# computes the factorial recursively using a base case of zero';
  it('scores a reformatted copy high and different work low', () => {
    const copy = original.replace(/\n\s*/g, ' ').toUpperCase();
    const other = 'def fib(k): a, b = 0, 1; for _ in range(k): a, b = b, a + b; return a  # iterative fibonacci with two variables';
    expect(jaccard(shingles(original), shingles(copy))).toBe(1);
    expect(jaccard(shingles(original), shingles(other))).toBeLessThan(0.1);
  });
  it('finds similar pairs, including files renamed inside ZIPs', () => {
    const pairs = similarPairs([
      { id: 'dana', files: [{ path: 'a/fact.py', text: original }] },
      { id: 'ron', files: [{ path: 'b/solution.py', text: original }, { path: 'b/notes.txt', text: 'something entirely different written by ron about his own approach to the task' }] },
      { id: 'noa', files: [{ path: 'c/main.py', text: 'class Stack:\n  def push(self, x): self.items.append(x)\n  def pop(self): return self.items.pop()  # a stack built on a python list' }] },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: 'dana', b: 'ron' });
    expect(pairs[0].files[0]).toMatchObject({ a: 'a/fact.py', b: 'b/solution.py', score: 1 });
  });
});

describe('review helpers', () => {
  const criteria = [
    { id: 'base', title: 'מקרה בסיס', description: '', points: 10 },
    { id: 'style', title: 'קוד נקי', description: '', points: 5 },
  ];
  it('normalizes the model answer: order, points from the verdict, missing criteria, no markdown', () => {
    const r = normalizeReview(
      { summary: ' טוב ', strengths: ['**א:** ב', 3, ''], improvements: ['1', '2', '3', '4', '5'], criteria: [{ criterionId: 'base', met: 'partial', feedback: 'יש', suggestion: '', points: 25 }, { criterionId: 'zzz', met: 'no' }] },
      criteria,
    );
    expect(r.summary).toBe('טוב');
    expect(r.strengths).toEqual(['א: ב']);
    expect(r.improvements).toHaveLength(4);
    expect(r.criteria).toEqual([
      { criterionId: 'base', met: 'partial', feedback: 'יש', suggestion: '', points: 5 },
      { criterionId: 'style', met: 'unknown', feedback: '', suggestion: '', points: 0 },
    ]);
  });
  it('limits criterion ids in the schema and trims long submissions evenly', () => {
    expect(JSON.stringify(reviewSchema(criteria))).toContain('"enum":["base","style"]');
    const t = submissionText([{ path: 'a.py', text: 'x'.repeat(20_000), code: true }, { path: 'b.py', text: 'y'.repeat(20_000), code: true }], 10_000);
    expect(t.truncated).toBe(true);
    expect(t.text.length).toBeLessThan(11_000);
    expect(t.text).toContain('=== קובץ: b.py ===');
  });
});

describe('compareToClass facts', () => {
  it('derives the lists from per-criterion numbers', async () => {
    const { compareToClass } = await import('../src/lib/assignments/review');
    const llm = async () => ({ summary: 'סיכום', othersDid: ['ignored'], standOut: ['ignored'] });
    const c = await compareToClass(
      { title: 't', criteria: [
        { id: 'a', title: 'מקרה בסיס', description: '', points: 1 },
        { id: 'b', title: 'סיבוכיות', description: '', points: 1 },
        { id: 'c', title: 'קלט שלילי', description: '', points: 1 },
      ] },
      { approach: '', summary: '', strengths: [], improvements: [], criteria: [{ criterionId: 'a', met: 'yes' }, { criterionId: 'b', met: 'partial' }, { criterionId: 'c', met: 'yes' }] },
      { approaches: [], commonStrengths: [], commonGaps: [] },
      { a: 90, b: 67, c: 20 },
      6,
      llm,
    );
    expect(c.likeMost).toEqual(['מקרה בסיס: עמדת בדרישה, כמו 90% מהכיתה']);
    expect(c.othersDid).toEqual(['סיבוכיות: 67% מהכיתה עמדו בדרישה, ואצלך זה חלקי']);
    expect(c.standOut).toEqual(['קלט שלילי: עמדת בדרישה, ורק 20% מהכיתה עמדו בה']);
    expect(c.summary).toBe('סיכום');
  });
});
