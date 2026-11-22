import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { normalizeHeader, parseRosterFile, parseRosterRows } from '../src/lib/roster';

const HE_HEADER = ['שם פרטי', 'שם משפחה', 'דוא״ל'];

describe('normalizeHeader', () => {
  it('treats gershayim, ASCII quote and no quote the same', () => {
    expect(normalizeHeader('דוא״ל')).toBe('דואל');
    expect(normalizeHeader('דוא"ל')).toBe('דואל');
    expect(normalizeHeader(' דואל ')).toBe('דואל');
  });
  it('ignores case, spaces and separators', () => {
    expect(normalizeHeader('First Name')).toBe('firstname');
    expect(normalizeHeader('e-mail')).toBe('email');
    expect(normalizeHeader('last_name')).toBe('lastname');
  });
});

describe('parseRosterRows', () => {
  it('reads the Hebrew header row (שם פרטי, שם משפחה, דוא״ל)', () => {
    const r = parseRosterRows([HE_HEADER, ['דנה', 'כהן', 'dana@uni.ac.il']]);
    expect(r.entries).toEqual([{ email: 'dana@uni.ac.il', firstName: 'דנה', lastName: 'כהן' }]);
    expect(r.skipped).toEqual([]);
  });

  it('finds columns regardless of order and English headers', () => {
    const r = parseRosterRows([
      ['Email', 'Last Name', 'First Name'],
      ['a@x.com', 'Levi', 'Noa'],
    ]);
    expect(r.entries).toEqual([{ email: 'a@x.com', firstName: 'Noa', lastName: 'Levi' }]);
  });

  it('normalizes email case and whitespace', () => {
    const r = parseRosterRows([HE_HEADER, ['א', 'ב', '  Dana@Uni.AC.IL ']]);
    expect(r.entries[0].email).toBe('dana@uni.ac.il');
  });

  it('counts duplicates (case-insensitive) once', () => {
    const r = parseRosterRows([HE_HEADER, ['א', 'ב', 'a@x.com'], ['א', 'ב', 'A@X.com']]);
    expect(r.entries).toHaveLength(1);
    expect(r.duplicates).toBe(1);
  });

  it('reports invalid and missing emails with spreadsheet row numbers', () => {
    const r = parseRosterRows([HE_HEADER, ['א', 'ב', 'not-an-email'], ['ג', 'ד', ''], ['ה', 'ו', 'ok@x.com']]);
    expect(r.entries).toHaveLength(1);
    expect(r.skipped).toEqual([
      { row: 2, value: 'not-an-email', reason: 'invalid email' },
      { row: 3, value: '', reason: 'missing email' },
    ]);
  });

  it('skips blank rows silently', () => {
    const r = parseRosterRows([HE_HEADER, ['', '', ''], ['א', 'ב', 'a@x.com']]);
    expect(r.entries).toHaveLength(1);
    expect(r.skipped).toEqual([]);
  });

  it('finds a header that is not on the first row (title rows above it)', () => {
    const r = parseRosterRows([['רשימת סטודנטים'], [], HE_HEADER, ['א', 'ב', 'a@x.com']]);
    expect(r.entries).toEqual([{ email: 'a@x.com', firstName: 'א', lastName: 'ב' }]);
  });

  it('splits a single full-name column into first and last name', () => {
    const r = parseRosterRows([['שם מלא', 'email'], ['נועה בת אל', 'a@x.com']]);
    expect(r.entries[0]).toEqual({ email: 'a@x.com', firstName: 'נועה', lastName: 'בת אל' });
  });

  it('without a header, uses the column that looks like emails', () => {
    const r = parseRosterRows([
      ['דנה', 'כהן', 'dana@x.com'],
      ['רון', 'לוי', 'ron@x.com'],
    ]);
    expect(r.entries.map((e) => e.email)).toEqual(['dana@x.com', 'ron@x.com']);
    expect(r.entries[0].firstName).toBe('');
  });

  it('returns nothing when there is no email column at all', () => {
    expect(parseRosterRows([['a', 'b'], ['c', 'd']]).entries).toEqual([]);
    expect(parseRosterRows([]).entries).toEqual([]);
  });
});

describe('parseRosterFile', () => {
  it('reads a UTF-8 CSV with BOM, gershayim header and quoted fields', async () => {
    const csv = '﻿שם פרטי,שם משפחה,דוא״ל\nדנה,"כהן, לוי",dana@uni.ac.il\nרון,לוי,ron@uni.ac.il\n';
    const r = await parseRosterFile(Buffer.from(csv, 'utf8'), 'roster.csv');
    expect(r.entries).toEqual([
      { email: 'dana@uni.ac.il', firstName: 'דנה', lastName: 'כהן, לוי' },
      { email: 'ron@uni.ac.il', firstName: 'רון', lastName: 'לוי' },
    ]);
  });

  it('reads an escaped ASCII-quote header from CSV (דוא""ל)', async () => {
    const csv = 'שם פרטי,שם משפחה,"דוא""ל"\nדנה,כהן,dana@uni.ac.il\n';
    const r = await parseRosterFile(Buffer.from(csv, 'utf8'), 'roster.csv');
    expect(r.entries).toHaveLength(1);
  });

  it('reads an .xlsx file, including hyperlink email cells', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(HE_HEADER);
    ws.addRow(['דנה', 'כהן', 'dana@uni.ac.il']);
    ws.addRow(['רון', 'לוי', { text: 'Ron@Uni.ac.il', hyperlink: 'mailto:ron@uni.ac.il' }]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parseRosterFile(buf, 'Roster.XLSX');
    expect(r.entries.map((e) => e.email)).toEqual(['dana@uni.ac.il', 'ron@uni.ac.il']);
    expect(r.entries[1]).toMatchObject({ firstName: 'רון', lastName: 'לוי' });
  });

  it('rejects other file types', async () => {
    await expect(parseRosterFile(Buffer.from(''), 'roster.pdf')).rejects.toThrow(/Unsupported/);
  });
});

describe('committed sample rosters', () => {
  it.each(['roster-sample.xlsx', 'roster-sample.csv'])('%s parses to 10 students, 1 duplicate, 1 invalid', async (f) => {
    const { readFileSync } = await import('node:fs');
    const r = await parseRosterFile(readFileSync(new URL(`../../samples/${f}`, import.meta.url)), f);
    expect(r.entries).toHaveLength(10);
    expect(r.duplicates).toBe(1);
    expect(r.skipped).toEqual([{ row: 13, value: 'not-an-email', reason: 'invalid email' }]);
    expect(r.entries[0]).toEqual({ email: 'student1@demo.test', firstName: 'דנה', lastName: 'כהן' });
  });
});
