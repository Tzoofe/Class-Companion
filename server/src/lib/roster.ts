import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

export interface RosterEntry {
  email: string;
  firstName: string;
  lastName: string;
}

export interface SkippedRow {
  row: number; // 1-based row number as seen in the spreadsheet
  value: string;
  reason: string;
}

export interface RosterParseResult {
  entries: RosterEntry[];
  skipped: SkippedRow[];
  duplicates: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (s: string): string => s.trim().toLowerCase();
export const isEmail = (s: string): boolean => EMAIL_RE.test(normalizeEmail(s));

/** Lowercase and drop spaces, quotes, gershayim/geresh, dots, dashes and underscores. */
export const normalizeHeader = (s: string): string =>
  s.toLowerCase().replace(/[\s"'`׳״._-]/g, '');

const HEADERS = {
  email: ['email', 'emailaddress', 'mail', 'דואל', 'אימייל', 'מייל', 'דוארלקטרוני', 'כתובתדואל'],
  firstName: ['firstname', 'first', 'givenname', 'שםפרטי'],
  lastName: ['lastname', 'last', 'surname', 'familyname', 'שםמשפחה'],
  fullName: ['name', 'fullname', 'שם', 'שםמלא'],
} as const;

type Field = keyof typeof HEADERS;

function findColumns(row: string[]): Partial<Record<Field, number>> {
  const cols: Partial<Record<Field, number>> = {};
  row.forEach((cell, i) => {
    const h = normalizeHeader(cell);
    for (const field of Object.keys(HEADERS) as Field[]) {
      if (cols[field] === undefined && (HEADERS[field] as readonly string[]).includes(h)) {
        cols[field] = i;
      }
    }
  });
  return cols;
}

/** Index of the column where most non-empty cells look like emails, or -1. */
function guessEmailColumn(rows: string[][]): number {
  const width = Math.max(0, ...rows.map((r) => r.length));
  let best = -1;
  let bestHits = 0;
  for (let c = 0; c < width; c++) {
    const hits = rows.filter((r) => isEmail(r[c] ?? '')).length;
    if (hits > bestHits) {
      best = c;
      bestHits = hits;
    }
  }
  return best;
}

/**
 * Turns spreadsheet rows into roster entries.
 * Header row is detected in the first 5 rows (English or Hebrew); without one,
 * the column that looks most like emails is used and names are left empty.
 */
export function parseRosterRows(rows: string[][]): RosterParseResult {
  const trimmed = rows.map((r) => r.map((c) => (c ?? '').toString().trim()));

  let headerIdx = -1;
  let cols: Partial<Record<Field, number>> = {};
  for (let i = 0; i < Math.min(5, trimmed.length); i++) {
    const found = findColumns(trimmed[i]);
    if (found.email !== undefined) {
      headerIdx = i;
      cols = found;
      break;
    }
  }
  if (headerIdx === -1) cols = { email: guessEmailColumn(trimmed) };

  const result: RosterParseResult = { entries: [], skipped: [], duplicates: 0 };
  if (cols.email === undefined || cols.email < 0) return result;

  const seen = new Set<string>();
  for (let i = headerIdx + 1; i < trimmed.length; i++) {
    const row = trimmed[i];
    if (row.every((c) => c === '')) continue;

    const raw = row[cols.email] ?? '';
    if (!isEmail(raw)) {
      result.skipped.push({ row: i + 1, value: raw, reason: raw ? 'invalid email' : 'missing email' });
      continue;
    }
    const email = normalizeEmail(raw);
    if (seen.has(email)) {
      result.duplicates++;
      continue;
    }
    seen.add(email);

    let firstName = cols.firstName !== undefined ? row[cols.firstName] ?? '' : '';
    let lastName = cols.lastName !== undefined ? row[cols.lastName] ?? '' : '';
    if (!firstName && !lastName && cols.fullName !== undefined) {
      const parts = (row[cols.fullName] ?? '').split(/\s+/).filter(Boolean);
      firstName = parts.shift() ?? '';
      lastName = parts.join(' ');
    }
    result.entries.push({ email, firstName, lastName });
  }
  return result;
}

/** Reads the first worksheet of a .xlsx or .csv file into rows of strings. */
export async function readSpreadsheet(buffer: Buffer, filename: string): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx')) {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } else if (lower.endsWith('.csv')) {
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    await wb.csv.read(Readable.from([text]), { parserOptions: { delimiter: ',' } } as never);
  } else {
    throw new Error('Unsupported file type (use .csv or .xlsx)');
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(row.getCell(c).text ?? '');
    rows[rowNumber - 1] = cells;
  });
  return Array.from(rows, (r) => r ?? []);
}

export async function parseRosterFile(buffer: Buffer, filename: string): Promise<RosterParseResult> {
  return parseRosterRows(await readSpreadsheet(buffer, filename));
}
