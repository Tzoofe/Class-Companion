// Debug helper: shows how the roster parser sees a file, WITHOUT printing student data.
// Usage (from server/): npx tsx scripts/inspect-roster.ts <file.xlsx|file.csv>
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { isEmail, normalizeHeader, parseRosterRows, readSpreadsheet } from '../src/lib/roster.js';

const file = process.argv[2];
if (!file) throw new Error('Usage: npx tsx scripts/inspect-roster.ts <file>');
const buf = readFileSync(file);

const shape = (v: string) => (v === '' ? '·' : isEmail(v) ? 'EMAIL' : /^\d+$/.test(v.trim()) ? 'NUM' : 'text');

if (file.toLowerCase().endsWith('.xlsx')) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  console.log('worksheets:', wb.worksheets.map((w) => `"${w.name}" (${w.rowCount} rows x ${w.columnCount} cols, state=${w.state})`).join(', '));
}

const rows = await readSpreadsheet(buf, basename(file));
console.log(`rows read from first worksheet: ${rows.length}`);
rows.slice(0, 8).forEach((r, i) => {
  const looksLikeHeader = r.some((c) => c && !isEmail(c) && normalizeHeader(c).length < 20) && !r.some(isEmail);
  const shown = looksLikeHeader && i < 5 ? r.map((c) => `${JSON.stringify(c)}→${normalizeHeader(c)}`) : r.map(shape);
  console.log(`  row ${i + 1}:`, shown.join(' | '));
});
const res = parseRosterRows(rows);
console.log(`RESULT entries: ${res.entries.length}, duplicates: ${res.duplicates}, skipped: ${res.skipped.length}`);
console.log('skip reasons:', [...new Set(res.skipped.map((s) => s.reason))].join(', ') || '-');
