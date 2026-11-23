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

export interface DashboardInput {
  roster: { email: string; firstName: string; lastName: string }[];
  users: { id: string; email: string }[];
  sessions: { id: string; status: string; startsAt: Date; endsAt: Date }[];
  attendance: { sessionId: string; studentId: string }[];
  now: Date;
}

export const DASHBOARD = {
  /** How many of the most recent finished sessions the chart shows. */
  chartSessions: 12,
  /** Students below this attendance % (over finished sessions) need attention. */
  atRiskPercent: 70,
  atRiskLimit: 5,
} as const;

/**
 * Course dashboard numbers. Rates use finished sessions only, so an open session
 * doesn't drag everyone's percentage down while students are still checking in.
 */
export function buildDashboard({ roster, users, sessions, attendance, now }: DashboardInput) {
  const rosterCount = roster.length;
  const userIdByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  const active = sessions.find((s) => isSessionActive(s, now)) ?? null;
  const finished = sessions
    .filter((s) => s !== active)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const finishedIds = new Set(finished.map((s) => s.id));

  const presentBySession = new Map<string, number>();
  const attendedByStudent = new Map<string, number>();
  for (const a of attendance) {
    presentBySession.set(a.sessionId, (presentBySession.get(a.sessionId) ?? 0) + 1);
    if (finishedIds.has(a.sessionId)) attendedByStudent.set(a.studentId, (attendedByStudent.get(a.studentId) ?? 0) + 1);
  }

  const pct = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 100));
  const history = finished.map((s) => ({ id: s.id, startsAt: s.startsAt, present: presentBySession.get(s.id) ?? 0 }));
  const totalPresent = history.reduce((sum, s) => sum + s.present, 0);

  const atRisk =
    finished.length === 0
      ? []
      : roster
          .map((r) => {
            const userId = userIdByEmail.get(r.email.toLowerCase());
            const attended = (userId && attendedByStudent.get(userId)) || 0;
            return { email: r.email, firstName: r.firstName, lastName: r.lastName, attended, percent: pct(attended, finished.length)! };
          })
          .filter((s) => s.percent < DASHBOARD.atRiskPercent)
          .sort((a, b) => a.percent - b.percent || a.lastName.localeCompare(b.lastName, 'he'))
          .slice(0, DASHBOARD.atRiskLimit);

  const last = history.at(-1) ?? null;
  return {
    rosterCount,
    registeredCount: roster.filter((r) => userIdByEmail.has(r.email.toLowerCase())).length,
    sessionCount: sessions.length,
    finishedSessionCount: finished.length,
    averagePercent: pct(totalPresent, finished.length * rosterCount),
    lastSession: last,
    live: active ? { id: active.id, endsAt: active.endsAt, present: presentBySession.get(active.id) ?? 0 } : null,
    history: history.slice(-DASHBOARD.chartSessions),
    atRisk,
    atRiskThreshold: DASHBOARD.atRiskPercent,
  };
}
