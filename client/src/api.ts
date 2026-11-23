const TOKEN_KEY = 'cc_token';

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string | null) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode etc. — stay logged in for this tab only */
    }
  },
};

/** Hebrew text for the server's (English) error messages. */
const HEBREW_ERRORS: Record<string, string> = {
  'Wrong email or password': 'אימייל או סיסמה שגויים',
  'Invalid email': 'כתובת אימייל לא תקינה',
  'Email already registered': 'האימייל כבר רשום — נסו להתחבר',
  'Not logged in': 'יש להתחבר מחדש',
  Forbidden: 'אין הרשאה לפעולה זו',
  'Missing roster file': 'יש לבחור קובץ',
  'Unsupported file type (use .csv or .xlsx)': 'סוג קובץ לא נתמך — השתמשו ב-‎.csv או ‎.xlsx',
  'File too large (max 2 MB)': 'הקובץ גדול מדי (עד 2MB)',
  'Course name is required': 'יש להזין שם קורס',
  'Radius must be between 5 and 500 meters': 'הרדיוס חייב להיות בין 5 ל-500 מטר',
  'No valid emails found in the file': 'לא נמצאו כתובות אימייל תקינות בקובץ',
  'Course not found': 'הקורס לא נמצא',
  'Session not found': 'המפגש לא נמצא',
  'Invalid location': 'מיקום לא תקין',
  'Location not precise enough': 'המיקום לא מדויק מספיק — המתינו לדיוק של עד 100 מ׳',
  'Location too imprecise': 'המיקום לא מדויק מספיק — הפעילו "מיקום מדויק" עבור Safari/Chrome בהגדרות',
  'Location reading too old': 'קריאת המיקום ישנה מדי — נסו שוב',
  'Not in range': 'נראה שאינך בטווח הכיתה',
  'Session is not active': 'הנוכחות כבר נסגרה',
  'Already checked in': 'נוכחותך כבר נרשמה',
  'Marked absent by lecturer': 'המרצה סימן/ה שלא נכחת במפגש הזה — אם זו טעות, פנו למרצה',
  'Student not on roster': 'הסטודנט/ית לא ברשימת הקורס',
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Parsed JSON body of the error response, if any. */
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = tokenStore.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers, body });
  } catch {
    throw new ApiError(0, 'אין חיבור לשרת');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status >= 500) throw new ApiError(res.status, 'שגיאת שרת, נסו שוב');
    if (res.status === 401 && path !== '/auth/login') tokenStore.set(null);
    const msg: string = data.error ?? '';
    throw new ApiError(res.status, HEBREW_ERRORS[msg] ?? (msg.startsWith('Password must') ? 'הסיסמה חייבת להכיל לפחות 6 תווים' : msg || 'שגיאה'), data);
  }
  return data as T;
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: 'lecturer' | 'student';
}

export interface RosterEntry {
  email: string;
  firstName: string;
  lastName: string;
}

export interface RosterPreview {
  entries: RosterEntry[];
  skipped: { row: number; value: string; reason: string }[];
  duplicates: number;
}

export interface LecturerCourse {
  id: string;
  name: string;
  rosterCount: number;
  defaultRadiusM: number;
}

export interface StudentCourse {
  id: string;
  name: string;
  lecturerName: string;
}

export interface StudentRow {
  email: string;
  firstName: string;
  lastName: string;
  registered: boolean;
  attended: number;
  totalSessions: number;
  percent: number | null;
  lastSeenAt: string | null;
  presentNow: boolean | null;
}

export interface CourseStudents {
  course: LecturerCourse & { registeredCount: number; sessionCount: number; activeSessionId: string | null };
  students: StudentRow[];
}

export interface LiveSession {
  id: string;
  courseId: string;
  center: { lat: number; lng: number };
  centerAccuracyM: number;
  radiusM: number;
  startsAt: string;
  endsAt: string;
  status: 'active' | 'closed';
}

export interface SessionStatus {
  session: LiveSession & { courseName: string };
  checkedInCount: number;
  rosterCount: number;
  serverNow: string;
}

export interface StudentActive {
  session: { id: string; courseId: string; radiusM: number; startsAt: string; endsAt: string; status: 'active' | 'closed' } | null;
  courseName: string;
  myCheckIn: { checkedInAt: string } | null;
  /** The lecturer marked this student absent for the open session. */
  markedAbsent: boolean;
  serverNow: string;
}

export interface RangeResult {
  inRange: boolean;
  distanceM: number;
  alreadyCheckedIn: boolean;
}

export interface CourseDashboard {
  course: { id: string; name: string; defaultRadiusM: number };
  rosterCount: number;
  registeredCount: number;
  sessionCount: number;
  finishedSessionCount: number;
  /** Over finished sessions; null when none yet. */
  averagePercent: number | null;
  lastSession: { id: string; startsAt: string; present: number } | null;
  live: { id: string; endsAt: string; present: number } | null;
  history: { id: string; startsAt: string; present: number }[];
  atRisk: { email: string; firstName: string; lastName: string; attended: number; percent: number }[];
  atRiskThreshold: number;
}

export interface SessionRosterRow {
  email: string;
  firstName: string;
  lastName: string;
  registered: boolean;
  present: boolean;
  /** Lecturer marked absent explicitly (blocks GPS check-in while the session is open). */
  markedAbsent: boolean;
  source: 'gps' | 'manual' | null;
  checkedInAt: string | null;
  distanceM: number | null;
}

export type SessionRoster = SessionStatus & { students: SessionRosterRow[] };

export interface CourseSessionsList {
  course: { id: string; name: string };
  rosterCount: number;
  sessions: { id: string; startsAt: string; endsAt: string; status: 'active' | 'closed'; present: number }[];
}
