import { haversineM, type LatLng } from './geo';

/** Attendance thresholds — single source for server validation and client UI. */
export const ATTENDANCE_RULES = {
  /** Lecturer can start a session only with a reading at least this precise. */
  lecturerMaxAccuracyM: 100,
  /** Student readings less precise than this are rejected outright. */
  studentMaxAccuracyM: 100,
  /** A check-in reading must be at most this old (|server now − reading time|). */
  readingMaxAgeMs: 30_000,
  defaultSessionMinutes: 15,
  defaultRadiusM: 20,
} as const;

export interface RangeInput {
  distanceM: number;
  studentAccuracyM: number;
  centerAccuracyM: number;
  radiusM: number;
}

/**
 * inRange ⇔ distance − studentAccuracy − centerAccuracy ≤ radius.
 * Both accuracy circles are given the benefit of the doubt: if they could overlap
 * the classroom circle, the student counts as present.
 */
export function isInRange({ distanceM, studentAccuracyM, centerAccuracyM, radiusM }: RangeInput): boolean {
  return distanceM - studentAccuracyM - centerAccuracyM <= radiusM;
}

export interface Located extends LatLng {
  accuracyM: number;
}

export function evaluateRange(student: Located, center: Located, radiusM: number): { distanceM: number; inRange: boolean } {
  const distanceM = haversineM(student, center);
  return {
    distanceM,
    inRange: isInRange({ distanceM, studentAccuracyM: student.accuracyM, centerAccuracyM: center.accuracyM, radiusM }),
  };
}

/** Reading time within ±readingMaxAgeMs of now (allows small device clock skew). */
export function isFresh(timestampMs: number, nowMs: number, maxAgeMs: number = ATTENDANCE_RULES.readingMaxAgeMs): boolean {
  return Number.isFinite(timestampMs) && Math.abs(nowMs - timestampMs) <= maxAgeMs;
}

const validAccuracy = (m: number) => Number.isFinite(m) && m >= 0;

export const isPreciseEnoughToStart = (accuracyM: number) =>
  validAccuracy(accuracyM) && accuracyM <= ATTENDANCE_RULES.lecturerMaxAccuracyM;

export const isPreciseEnoughToCheckIn = (accuracyM: number) =>
  validAccuracy(accuracyM) && accuracyM <= ATTENDANCE_RULES.studentMaxAccuracyM;
