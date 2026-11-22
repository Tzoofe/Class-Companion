// Writes samples/roster-sample.{xlsx,csv} for trying the "new course" upload.
// Includes 5 students from the seed roster, 5 new ones, one duplicate and one invalid row.
import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
import { STUDENTS } from '../src/seed-data.js';

const outDir = new URL('../../samples/', import.meta.url);
const header = ['שם פרטי', 'שם משפחה', 'דוא״ל'];
const extra = [
  ['ליאור', 'גבאי'],
  ['הילה', 'סויסה'],
  ['גיא', 'אוחיון'],
  ['רותם', 'אלון'],
  ['אורי', 'קליין'],
].map(([firstName, lastName], i) => ({ firstName, lastName, email: `student${11 + i}@demo.test` }));

const rows = [...STUDENTS.slice(0, 5), ...extra].map((s) => [s.firstName, s.lastName, s.email]);
rows.push(['כפול', 'כפול', 'STUDENT1@demo.test']); // duplicate (case-insensitive)
rows.push(['שגוי', 'שגוי', 'not-an-email']); // invalid

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('סטודנטים', { views: [{ rightToLeft: true }] });
ws.addRow(header);
rows.forEach((r) => ws.addRow(r));
ws.columns.forEach((c) => (c.width = 22));

writeFileSync(new URL('roster-sample.xlsx', outDir), Buffer.from(await wb.xlsx.writeBuffer()));
writeFileSync(new URL('roster-sample.csv', outDir), '﻿' + [header, ...rows].map((r) => r.join(',')).join('\n') + '\n');
console.log('Wrote samples/roster-sample.xlsx and samples/roster-sample.csv');
