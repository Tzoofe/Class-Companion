export interface StatsInput {
  roster: { email: string; firstName: string; lastName: string }[];
  users: { id: string; email: string }[];
  sessions: { id: string; status: string; endsAt: Date }[];
  attendance: { sessionId: string; studentId: string; checkedInAt: Date }[];
  now: Date;
}

export interface StudentRow {
  email: string;
  firstName: string;
  lastName: string;
  /** Has an account (signed up). */
  registered: boolean;
  attended: number;
  totalSessions: number;
  /** Rounded attendance %, or null when the course has no sessions yet. */
  percent: number | null;
  lastSeenAt: Date | null;
  /** Checked in to the currently active session; null when no session is active. */
  presentNow: boolean | null;
}

export const isSessionActive = (s: { status: string; endsAt: Date }, now: Date): boolean =>
  s.status === 'active' && s.endsAt.getTime() > now.getTime();

/** One row per roster entry with attendance stats, sorted by last name then first name (Hebrew collation). */
export function buildStudentRows({ roster, users, sessions, attendance, now }: StatsInput): StudentRow[] {
  const userIdByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  const sessionIds = new Set(sessions.map((s) => s.id));
  const activeId = sessions.find((s) => isSessionActive(s, now))?.id ?? null;

  const byStudent = new Map<string, { count: number; last: Date | null; inActive: boolean }>();
  for (const a of attendance) {
    if (!sessionIds.has(a.sessionId)) continue;
    const s = byStudent.get(a.studentId) ?? { count: 0, last: null, inActive: false };
    s.count++;
    if (!s.last || a.checkedInAt > s.last) s.last = a.checkedInAt;
    if (a.sessionId === activeId) s.inActive = true;
    byStudent.set(a.studentId, s);
  }

  const total = sessions.length;
  const collator = new Intl.Collator('he');
  return roster
    .map((r) => {
      const userId = userIdByEmail.get(r.email.toLowerCase());
      const s = (userId && byStudent.get(userId)) || { count: 0, last: null, inActive: false };
      return {
        email: r.email,
        firstName: r.firstName,
        lastName: r.lastName,
        registered: userId !== undefined,
        attended: s.count,
        totalSessions: total,
        percent: total === 0 ? null : Math.round((s.count / total) * 100),
        lastSeenAt: s.last,
        presentNow: activeId === null ? null : s.inActive,
      };
    })
    .sort((a, b) => collator.compare(a.lastName, b.lastName) || collator.compare(a.firstName, b.firstName));
}
