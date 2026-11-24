import ExcelJS from 'exceljs';
import { buildStudentRows, type StatsInput } from './stats.js';

export interface ExportRecord {
  sessionId: string;
  email: string;
  present: boolean;
  source: string;
  checkedInAt: Date;
  distanceM?: number | null;
  accuracyM?: number | null;
}

export interface ExportInput {
  courseName: string;
  roster: StatsInput['roster'];
  users: StatsInput['users'];
  sessions: { id: string; status: string; startsAt: Date; endsAt: Date }[];
  records: ExportRecord[];
  now: Date;
  timeZone: string;
}

/**
 * Excel stores dates without a time zone and shows them as-is, so convert to the wall-clock
 * time in `timeZone` and store that.
 */
export function toWallClock(d: Date, timeZone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(d)
      .map((p) => [p.type, Number(p.value)]),
  );
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Sheet names: max 31 chars, none of : \ / ? * [ ], unique (case-insensitive). */
export function sessionSheetName(startsAt: Date, timeZone: string, taken: Set<string>): string {
  const w = toWallClock(startsAt, timeZone);
  const base = `${pad(w.getUTCDate())}.${pad(w.getUTCMonth() + 1)}.${String(w.getUTCFullYear()).slice(2)} ${pad(w.getUTCHours())}.${pad(w.getUTCMinutes())}`;
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} (${i})`;
  taken.add(name.toLowerCase());
  return name;
}

const DATE_TIME = 'dd/mm/yyyy hh:mm';
const TIME = 'hh:mm';

function styleSheet(ws: ExcelJS.Worksheet, headerRow: number) {
  ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: headerRow }];
  const header = ws.getRow(headerRow);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: ws.columnCount } };
}

/** Summary sheet + one sheet per session (oldest first). */
export function buildCourseWorkbook({ courseName, roster, users, sessions, records, now, timeZone }: ExportInput): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Class Companion';
  wb.created = now;
  const local = (d: Date | null | undefined) => (d ? toWallClock(d, timeZone) : null);
  const ordered = [...sessions].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const present = records.filter((r) => r.present);

  // Summary
  const summary = wb.addWorksheet('סיכום');
  summary.addRow([courseName]).font = { bold: true, size: 14 };
  summary.addRow([`${sessions.length} מפגשים · ${roster.length} סטודנטים · הופק ב-`, local(now)]);
  summary.getCell('B2').numFmt = DATE_TIME;
  summary.addRow([]);
  summary.columns = [
    { key: 'lastName', width: 16 },
    { key: 'firstName', width: 14 },
    { key: 'email', width: 30 },
    { key: 'registered', width: 10 },
    { key: 'attended', width: 10 },
    { key: 'total', width: 10 },
    { key: 'percent', width: 10 },
    { key: 'lastSeen', width: 18 },
  ];
  summary.addRow(['שם משפחה', 'שם פרטי', 'אימייל', 'רשום/ה', 'נוכחות', 'מתוך', 'אחוז', 'נראה לאחרונה']);
  const rows = buildStudentRows({
    roster,
    users,
    sessions,
    attendance: present.map((r) => ({ sessionId: r.sessionId, email: r.email, checkedInAt: r.checkedInAt })),
    now,
  });
  for (const s of rows) {
    const row = summary.addRow([s.lastName, s.firstName, s.email, s.registered ? 'כן' : 'לא', s.attended, s.totalSessions, s.percent === null ? null : s.percent / 100, local(s.lastSeenAt)]);
    row.getCell(7).numFmt = '0%';
    row.getCell(8).numFmt = DATE_TIME;
  }
  styleSheet(summary, 4);

  // One sheet per session
  const byKey = new Map(records.map((r) => [`${r.sessionId}|${r.email.toLowerCase()}`, r]));
  const taken = new Set(['סיכום']);
  for (const session of ordered) {
    const ws = wb.addWorksheet(sessionSheetName(session.startsAt, timeZone, taken));
    const count = present.filter((r) => r.sessionId === session.id).length;
    ws.addRow([courseName]).font = { bold: true, size: 14 };
    ws.addRow([`${count}/${roster.length} נוכחים · התחלה`, local(session.startsAt), 'סיום', local(session.endsAt)]);
    ws.getCell('B2').numFmt = DATE_TIME;
    ws.getCell('D2').numFmt = DATE_TIME;
    ws.addRow([]);
    ws.columns = [
      { width: 16 },
      { width: 14 },
      { width: 30 },
      { width: 10 },
      { width: 10 },
      { width: 12 },
      { width: 10 },
      { width: 10 },
    ];
    ws.addRow(['שם משפחה', 'שם פרטי', 'אימייל', 'נוכח/ת', 'מקור', 'שעת סימון', 'מרחק (מ׳)', 'דיוק (מ׳)']);
    for (const s of rows) {
      const r = byKey.get(`${session.id}|${s.email.toLowerCase()}`);
      const here = !!r?.present;
      const gps = here && r!.source === 'gps';
      const row = ws.addRow([
        s.lastName,
        s.firstName,
        s.email,
        here ? 'כן' : 'לא',
        here ? (gps ? 'GPS' : 'ידני') : r ? 'סומן כלא נוכח/ת' : null,
        here ? local(r!.checkedInAt) : null,
        gps ? (r!.distanceM ?? null) : null,
        gps ? (r!.accuracyM ?? null) : null,
      ]);
      row.getCell(6).numFmt = TIME;
      if (here) row.getCell(4).font = { color: { argb: 'FF047857' }, bold: true };
    }
    styleSheet(ws, 4);
  }
  return wb;
}
