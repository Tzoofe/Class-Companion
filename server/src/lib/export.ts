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

export interface ExportPost {
  createdAt: Date;
  kind: string;
  text: string;
  authorEmail: string;
  anonymous: boolean;
  votes: number;
  status: string;
  pinned: boolean;
  hidden: boolean;
  duringClass: boolean;
  reply: string;
}

export interface ExportPoll {
  openedAt: Date | null;
  question: string;
  type: string;
  /** One line per option / value, e.g. "כן: 12 ✓". */
  summary: string;
  responses: number;
  answers: { email: string; answer: string; correct: boolean | null }[];
}

export interface ExportInput {
  courseName: string;
  roster: StatsInput['roster'];
  users: StatsInput['users'];
  sessions: { id: string; status: string; startsAt: Date; endsAt: Date }[];
  records: ExportRecord[];
  /** Course feed (questions & suggestions); its sheet is added only when there are posts. */
  posts?: ExportPost[];
  /** Opened polls, oldest first; sheets are added only when there are polls. */
  polls?: ExportPoll[];
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
export function buildCourseWorkbook({ courseName, roster, users, sessions, records, posts = [], polls = [], now, timeZone }: ExportInput): ExcelJS.Workbook {
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
  const taken = new Set(['סיכום', 'שאלות והערות', 'סקרים', 'תשובות לסקרים']);
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

  if (posts.length > 0) {
    const nameByEmail = new Map(roster.map((r) => [r.email.toLowerCase(), `${r.firstName} ${r.lastName}`.trim()]));
    const ws = wb.addWorksheet('שאלות והערות');
    ws.addRow([courseName]).font = { bold: true, size: 14 };
    ws.addRow([`${posts.length} פרסומים`]);
    ws.addRow([]);
    ws.columns = [{ width: 16 }, { width: 10 }, { width: 60 }, { width: 18 }, { width: 10 }, { width: 8 }, { width: 10 }, { width: 10 }, { width: 40 }];
    ws.addRow(['תאריך', 'סוג', 'תוכן', 'מאת', 'אנונימי', '👍', 'סטטוס', 'בזמן שיעור', 'תגובת המרצה']);
    for (const p of posts) {
      const status = p.hidden ? 'מוסתר' : p.status === 'answered' ? 'נענה' : 'פתוח';
      const row = ws.addRow([
        local(p.createdAt),
        p.kind === 'question' ? 'שאלה' : 'הצעה',
        p.text,
        nameByEmail.get(p.authorEmail.toLowerCase()) || p.authorEmail,
        p.anonymous ? 'כן' : 'לא',
        p.votes,
        p.pinned ? `${status} · נעוץ` : status,
        p.duringClass ? 'כן' : 'לא',
        p.reply || null,
      ]);
      row.getCell(1).numFmt = DATE_TIME;
      row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
      row.getCell(9).alignment = { wrapText: true, vertical: 'top' };
    }
    styleSheet(ws, 4);
  }

  if (polls.length > 0) {
    const nameByEmail = new Map(roster.map((r) => [r.email.toLowerCase(), r]));
    const TYPE: Record<string, string> = { choice: 'בחירה', yesno: 'כן/לא', scale: 'סולם 1–5', text: 'טקסט חופשי' };

    const ws = wb.addWorksheet('סקרים');
    ws.addRow([courseName]).font = { bold: true, size: 14 };
    ws.addRow([`${polls.length} סקרים`]);
    ws.addRow([]);
    ws.columns = [{ width: 16 }, { width: 50 }, { width: 12 }, { width: 10 }, { width: 50 }];
    ws.addRow(['נפתח', 'שאלה', 'סוג', 'עונים', 'תוצאות']);
    for (const p of polls) {
      const row = ws.addRow([local(p.openedAt), p.question, TYPE[p.type] ?? p.type, p.responses, p.summary]);
      row.getCell(1).numFmt = DATE_TIME;
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      row.getCell(5).alignment = { wrapText: true, vertical: 'top' };
    }
    styleSheet(ws, 4);

    const answers = wb.addWorksheet('תשובות לסקרים');
    answers.addRow([courseName]).font = { bold: true, size: 14 };
    answers.addRow(['תשובה של כל סטודנט/ית בכל סקר']);
    answers.addRow([]);
    answers.columns = [{ width: 40 }, { width: 16 }, { width: 14 }, { width: 30 }, { width: 40 }, { width: 8 }];
    answers.addRow(['שאלה', 'שם משפחה', 'שם פרטי', 'אימייל', 'תשובה', 'נכון']);
    for (const p of polls) {
      for (const a of p.answers) {
        const r = nameByEmail.get(a.email.toLowerCase());
        answers.addRow([p.question, r?.lastName ?? '', r?.firstName ?? '', a.email, a.answer, a.correct === null ? null : a.correct ? 'כן' : 'לא']);
      }
    }
    styleSheet(answers, 4);
  }
  return wb;
}
