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
  'Post text is required': 'כתבו משהו לפני השליחה',
  'Post is too long': 'הטקסט ארוך מדי (עד 500 תווים)',
  'Reply is too long': 'התגובה ארוכה מדי (עד 1000 תווים)',
  'Too many posts, wait a minute': 'שלחת הרבה הודעות ברצף — נסו שוב בעוד דקה',
  'Post not found': 'ההודעה לא נמצאה (אולי נמחקה)',
  'Cannot vote for your own post': 'אי אפשר להצביע להודעה שלך',
  'Question is required': 'כתבו שאלה',
  'Question is too long': 'השאלה ארוכה מדי (עד 300 תווים)',
  'A poll needs 2–6 options': 'סקר צריך 2–6 אפשרויות',
  'Options cannot be empty': 'יש אפשרות ריקה',
  'Options must be different': 'האפשרויות חייבות להיות שונות',
  'Option is too long': 'אפשרות ארוכה מדי (עד 120 תווים)',
  'Invalid correct answer': 'התשובה הנכונה לא תקינה',
  'Attendance is not open': 'סקר "רק לנוכחים" אפשר לפתוח רק כשהנוכחות פתוחה',
  'Only drafts can be edited': 'אפשר לערוך רק טיוטות',
  'Poll not found': 'הסקר לא נמצא',
  'Poll is closed': 'הסקר נסגר',
  'Only students present in class can answer': 'הסקר פתוח רק למי שנכח/ה בשיעור',
  'Choose one answer': 'בחרו תשובה אחת',
  'Invalid answer': 'בחרו תשובה',
  'Answer is too long': 'התשובה ארוכה מדי (עד 200 תווים)',
  'Invalid schedule': 'מערכת השעות לא תקינה',
  'Too many weekly slots': 'יותר מדי שיעורים בשבוע (עד 14)',
  'Invalid class time': 'שעת סיום חייבת להיות אחרי שעת ההתחלה',
  'Invalid date': 'תאריך לא תקין',
  'Semester ends before it starts': 'סוף הסמסטר לפני תחילתו',
  'Invalid event type': 'סוג אירוע לא תקין',
  'Invalid start time': 'שעת התחלה לא תקינה',
  'Invalid end time': 'שעת הסיום חייבת להיות אחרי שעת ההתחלה',
  'Title is required': 'יש להזין כותרת',
  'Link must start with http:// or https://': 'הקישור צריך להתחיל ב-https://',
  'Choose a class on that day to cancel': 'בחרו שיעור שמתקיים ביום הזה',
  'That class is already cancelled': 'השיעור הזה כבר בוטל',
  'Event not found': 'האירוע לא נמצא',
  'Student already on roster': 'הסטודנט/ית כבר ברשימה',
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
  feed: { openQuestions: number; totalPosts: number };
  polls: { open: { id: string; question: string } | null; total: number };
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
  accuracyM: number | null;
}

export type SessionRoster = SessionStatus & { students: SessionRosterRow[] };

export interface CourseSessionsList {
  course: { id: string; name: string };
  rosterCount: number;
  sessions: { id: string; startsAt: string; endsAt: string; status: 'active' | 'closed'; present: number }[];
}

/** Downloads a file from an authenticated endpoint and hands it to the browser as a download. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const headers = new Headers();
  const token = tokenStore.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { headers });
  } catch {
    throw new ApiError(0, 'אין חיבור לשרת');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, HEBREW_ERRORS[data.error] ?? 'ההורדה נכשלה, נסו שוב', data);
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const name = encoded ? decodeURIComponent(encoded) : fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type PostKind = 'question' | 'suggestion';

export interface FeedPost {
  id: string;
  kind: PostKind;
  text: string;
  createdAt: string;
  duringClass: boolean;
  /** null = anonymous and not yours (the server never sends the name). */
  author: string | null;
  anonymous: boolean;
  mine: boolean;
  votes: number;
  votedByMe: boolean;
  status: 'open' | 'answered';
  pinned: boolean;
  hidden: boolean;
  reply: { text: string; at: string } | null;
}

export interface CourseFeed {
  course: { id: string; name: string };
  posts: FeedPost[];
  serverNow: string;
}

export const POST_MAX_LENGTH = 500;

export type PollType = 'choice' | 'yesno' | 'scale' | 'text';

export interface PollResults {
  responses: number;
  counts?: Record<string, number>;
  scale?: { counts: number[]; average: number | null };
  texts?: string[];
}

export interface PollAnswer {
  optionIds?: string[];
  value?: number;
  text?: string;
}

interface PollBase {
  id: string;
  question: string;
  type: PollType;
  multiple: boolean;
  options: { id: string; text: string }[];
  audience: 'roster' | 'present';
  status: 'draft' | 'open' | 'closed';
  resultsRevealed: boolean;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  correctOptionIds: string[];
}

export interface LecturerPoll extends PollBase {
  showTextOnScreen: boolean;
  results: PollResults;
  /** How many students may answer. */
  eligible: number;
}

export interface StudentPoll extends PollBase {
  canAnswer: boolean;
  eligible: boolean;
  myAnswer: PollAnswer | null;
  /** null until the lecturer reveals results. */
  results: PollResults | null;
}

export interface CoursePolls<P> {
  course: { id: string; name: string };
  polls: P[];
}

/** What the poll editor sends: options as texts, correct as option indexes (or 'yes'/'no'). */
export interface PollDraft {
  question: string;
  type: PollType;
  multiple: boolean;
  options: string[];
  correct: (number | 'yes' | 'no')[];
  audience: 'roster' | 'present';
  showTextOnScreen: boolean;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** File → { fileName, fileBase64 } as the API expects for roster uploads. */
export async function fileBody(file: File, extra: Record<string, unknown> = {}) {
  if (file.size > MAX_FILE_BYTES) throw new Error('הקובץ גדול מדי (עד 2MB)');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { ...extra, fileName: file.name, fileBase64: btoa(binary) };
}

// ── Course settings, schedule & agenda ──

export interface RosterMember {
  email: string;
  firstName: string;
  lastName: string;
  registered: boolean;
}

export interface CourseSettings {
  id: string;
  name: string;
  defaultRadiusM: number;
  roster: RosterMember[];
}

export interface Slot {
  id?: string;
  weekday: number;
  start: string;
  end: string;
  title: string;
  place: string;
}

export type EventKind = 'extra' | 'cancelled' | 'office' | 'meeting' | 'exam' | 'other';

export interface CourseEvent {
  id: string;
  courseId: string;
  kind: EventKind;
  date: string;
  start: string | null;
  end: string | null;
  title: string;
  place: string;
  link: string;
  notes: string;
  slotId: string | null;
}

export interface CourseSchedule {
  course: { id: string; name: string };
  schedule: Slot[];
  semesterStart: string | null;
  semesterEnd: string | null;
  events: CourseEvent[];
  today: string;
}

export interface AgendaItem {
  date: string;
  start: string;
  end: string | null;
  courseId: string;
  courseName: string;
  kind: 'class' | Exclude<EventKind, 'cancelled'>;
  title: string;
  place: string;
  link: string;
  notes: string;
  cancelled: boolean;
  slotId?: string;
  eventId?: string;
}

export interface Agenda {
  now: { date: string; time: string; weekday: number };
  from: string;
  days: number;
  items: AgendaItem[];
  hasSchedule: boolean;
}

export interface LecturerOverview {
  live: {
    sessions: { courseId: string; courseName: string; sessionId: string; present: number; rosterCount: number; endsAt: string }[];
    polls: { courseId: string; courseName: string; pollId: string; question: string; responses: number }[];
  };
  totals: { courses: number; students: number; openQuestions: number; weekAttendancePercent: number | null };
  attention: {
    questions: { courseId: string; courseName: string; postId: string; text: string; votes: number; createdAt: string }[];
    atRisk: { courseId: string; courseName: string; count: number }[];
  };
  courses: {
    id: string;
    name: string;
    rosterCount: number;
    registeredCount: number;
    sessionCount: number;
    averagePercent: number | null;
    lastSession: { startsAt: string; present: number } | null;
    trend: number[];
    openQuestions: number;
    pollOpen: boolean;
    liveSession: boolean;
    atRiskCount: number;
  }[];
}

export const WEEKDAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
