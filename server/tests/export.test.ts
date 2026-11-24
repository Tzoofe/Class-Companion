import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildCourseWorkbook, sessionSheetName, toWallClock, type ExportInput } from '../src/lib/export';
import { Attendance } from '../src/models/Attendance';
import { Course } from '../src/models/Course';
import { Session } from '../src/models/Session';
import { User } from '../src/models/User';
import { api, createLecturer, loginToken, useTestDb } from './helpers';

const TZ = 'Asia/Jerusalem';

describe('toWallClock', () => {
  it('stores the local wall-clock time (winter UTC+2, summer UTC+3)', () => {
    expect(toWallClock(new Date('2026-11-24T08:30:00Z'), TZ).toISOString()).toBe('2026-11-24T10:30:00.000Z');
    expect(toWallClock(new Date('2026-07-01T08:30:00Z'), TZ).toISOString()).toBe('2026-07-01T11:30:00.000Z');
  });
});

describe('sessionSheetName', () => {
  it('uses the local date/time and stays unique', () => {
    const taken = new Set<string>();
    const d = new Date('2026-11-24T08:30:00Z');
    expect(sessionSheetName(d, TZ, taken)).toBe('24.11.26 10.30');
    expect(sessionSheetName(d, TZ, taken)).toBe('24.11.26 10.30 (2)');
  });
});

describe('buildCourseWorkbook', () => {
  const input: ExportInput = {
    courseName: 'מבוא',
    roster: [
      { email: 'dana@x.com', firstName: 'דנה', lastName: 'כהן' },
      { email: 'late@x.com', firstName: 'אורי', lastName: 'אלון' },
    ],
    users: [{ id: 'u1', email: 'dana@x.com' }],
    sessions: [
      { id: 's2', status: 'closed', startsAt: new Date('2026-11-24T08:00:00Z'), endsAt: new Date('2026-11-24T08:15:00Z') },
      { id: 's1', status: 'closed', startsAt: new Date('2026-11-17T08:00:00Z'), endsAt: new Date('2026-11-17T08:15:00Z') },
    ],
    records: [
      { sessionId: 's1', email: 'dana@x.com', present: true, source: 'gps', checkedInAt: new Date('2026-11-17T08:03:00Z'), distanceM: 7.3, accuracyM: 12 },
      { sessionId: 's2', email: 'late@x.com', present: true, source: 'manual', checkedInAt: new Date('2026-11-24T08:00:00Z') },
      { sessionId: 's2', email: 'dana@x.com', present: false, source: 'manual', checkedInAt: new Date('2026-11-24T08:05:00Z') },
    ],
    now: new Date('2026-11-24T12:00:00Z'),
    timeZone: TZ,
  };

  it('has a summary sheet and one sheet per session, oldest first', () => {
    const wb = buildCourseWorkbook(input);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['סיכום', '17.11.26 10.00', '24.11.26 10.00']);
    expect(wb.worksheets.every((w) => w.views[0]?.rightToLeft)).toBe(true);
  });

  it('summarises each student', () => {
    const ws = buildCourseWorkbook(input).getWorksheet('סיכום')!;
    expect(ws.getRow(4).values).toEqual([, 'שם משפחה', 'שם פרטי', 'אימייל', 'רשום/ה', 'נוכחות', 'מתוך', 'אחוז', 'נראה לאחרונה']);
    // sorted by last name: אלון, כהן
    expect((ws.getRow(5).values as unknown[]).slice(1, 8)).toEqual(['אלון', 'אורי', 'late@x.com', 'לא', 1, 2, 0.5]);
    expect((ws.getRow(6).values as unknown[]).slice(1, 8)).toEqual(['כהן', 'דנה', 'dana@x.com', 'כן', 1, 2, 0.5]);
    expect(ws.getRow(6).getCell(8).value).toEqual(new Date('2026-11-17T10:03:00Z')); // local wall clock
  });

  it('adds a questions & comments sheet with real names, only when there are posts', () => {
    expect(buildCourseWorkbook(input).getWorksheet('שאלות והערות')).toBeUndefined();
    const wb = buildCourseWorkbook({
      ...input,
      posts: [
        { createdAt: new Date('2026-11-24T08:05:00Z'), kind: 'question', text: 'מה זה?', authorEmail: 'dana@x.com', anonymous: true, votes: 3, status: 'answered', pinned: true, hidden: false, duringClass: true, reply: 'ככה' },
      ],
    });
    const ws = wb.getWorksheet('שאלות והערות')!;
    expect((ws.getRow(5).values as unknown[]).slice(1)).toEqual([new Date('2026-11-24T10:05:00Z'), 'שאלה', 'מה זה?', 'דנה כהן', 'כן', 3, 'נענה · נעוץ', 'כן', 'ככה']);
  });

  it('lists every student per session with source, time, distance and accuracy', () => {
    const wb = buildCourseWorkbook(input);
    const first = wb.getWorksheet('17.11.26 10.00')!;
    expect((first.getRow(6).values as unknown[]).slice(1)).toEqual(['כהן', 'דנה', 'dana@x.com', 'כן', 'GPS', new Date('2026-11-17T10:03:00Z'), 7.3, 12]);
    expect((first.getRow(5).values as unknown[]).slice(1, 5)).toEqual(['אלון', 'אורי', 'late@x.com', 'לא']);
    const second = wb.getWorksheet('24.11.26 10.00')!;
    expect((second.getRow(5).values as unknown[]).slice(1, 6)).toEqual(['אלון', 'אורי', 'late@x.com', 'כן', 'ידני']);
    expect((second.getRow(6).values as unknown[]).slice(1, 6)).toEqual(['כהן', 'דנה', 'dana@x.com', 'לא', 'סומן כלא נוכח/ת']);
  });
});

describe('GET /api/courses/:id/export', () => {
  useTestDb();

  async function setup() {
    const lect = await createLecturer();
    const course = await Course.create({ name: 'מבוא', lecturerId: lect._id, roster: [{ email: 'dana@uni.ac.il', firstName: 'דנה', lastName: 'כהן' }] });
    const dana = await User.create({ email: 'dana@uni.ac.il', passwordHash: 'x', role: 'student' });
    const s = await Session.create({
      courseId: course._id,
      center: { type: 'Point', coordinates: [34.8, 32.1] },
      centerAccuracyM: 10,
      radiusM: 20,
      startsAt: new Date(Date.now() - 36e5),
      endsAt: new Date(Date.now() - 35e5),
      status: 'closed',
    });
    await Attendance.create({ sessionId: s._id, email: 'dana@uni.ac.il', studentId: dana._id, source: 'gps', distanceM: 4, accuracyM: 9 });
    return { course, auth: { Authorization: `Bearer ${await loginToken('lect@uni.ac.il')}` } };
  }

  it('downloads a readable .xlsx', async () => {
    const { course, auth } = await setup();
    const res = await api()
      .get(`/api/courses/${course.id}/export`)
      .set(auth)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    expect(wb.worksheets).toHaveLength(2);
    expect(wb.getWorksheet('סיכום')!.getRow(5).getCell(5).value).toBe(1);
  });

  it("is the owning lecturer's only", async () => {
    const { course } = await setup();
    await createLecturer('other@uni.ac.il');
    expect((await api().get(`/api/courses/${course.id}/export`).set({ Authorization: `Bearer ${await loginToken('other@uni.ac.il')}` })).status).toBe(404);
    const student = (await api().post('/api/auth/signup').send({ email: 'x@uni.ac.il', password: 'secret123' })).body.token;
    expect((await api().get(`/api/courses/${course.id}/export`).set({ Authorization: `Bearer ${student}` })).status).toBe(403);
  });
});
