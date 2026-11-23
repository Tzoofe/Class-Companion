import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_RULES as R,
  evaluateRange,
  isFresh,
  isInRange,
  isPreciseEnoughToStart,
  isPreciseEnoughToCheckIn,
} from '../../shared/attendance';
import { haversineM } from '../../shared/geo';

describe('ATTENDANCE_RULES', () => {
  it('matches the agreed thresholds', () => {
    expect(R).toMatchObject({
      lecturerMaxAccuracyM: 100,
      studentMaxAccuracyM: 100,
      readingMaxAgeMs: 30_000,
      defaultSessionMinutes: 15,
      defaultRadiusM: 20,
    });
  });
});

describe('isInRange  (distance − studentAcc − centerAcc ≤ radius)', () => {
  const base = { studentAccuracyM: 10, centerAccuracyM: 10, radiusM: 20 };

  it('is in range well inside the radius', () => {
    expect(isInRange({ ...base, distanceM: 5 })).toBe(true);
  });
  it('is in range exactly on the edge (40 − 10 − 10 = 20)', () => {
    expect(isInRange({ ...base, distanceM: 40 })).toBe(true);
  });
  it('is out of range just past the edge', () => {
    expect(isInRange({ ...base, distanceM: 40.01 })).toBe(false);
  });
  it('with perfect accuracy reduces to distance ≤ radius', () => {
    const exact = { studentAccuracyM: 0, centerAccuracyM: 0, radiusM: 20 };
    expect(isInRange({ ...exact, distanceM: 20 })).toBe(true);
    expect(isInRange({ ...exact, distanceM: 21 })).toBe(false);
  });
  it('larger accuracy circles give more slack', () => {
    expect(isInRange({ distanceM: 150, studentAccuracyM: 100, centerAccuracyM: 30, radiusM: 20 })).toBe(true);
    expect(isInRange({ distanceM: 151, studentAccuracyM: 100, centerAccuracyM: 30, radiusM: 20 })).toBe(false);
  });
  it('distance 0 is always in range', () => {
    expect(isInRange({ distanceM: 0, studentAccuracyM: 0, centerAccuracyM: 0, radiusM: 1 })).toBe(true);
  });
});

describe('evaluateRange', () => {
  const center = { lat: 32.1, lng: 34.8, accuracyM: 10 };
  it('computes Haversine distance and the verdict', () => {
    const student = { lat: 32.1001, lng: 34.8, accuracyM: 5 }; // ≈ 11.12 m north
    const r = evaluateRange(student, center, 20);
    expect(r.distanceM).toBeCloseTo(haversineM(student, center), 6);
    expect(r.distanceM).toBeCloseTo(11.12, 1);
    expect(r.inRange).toBe(true);
  });
  it('is out of range ~100 m away with good accuracy', () => {
    const r = evaluateRange({ lat: 32.1009, lng: 34.8, accuracyM: 5 }, center, 20);
    expect(r.distanceM).toBeGreaterThan(99);
    expect(r.inRange).toBe(false);
  });
});

describe('isFresh', () => {
  const now = 1_000_000_000;
  it('accepts readings up to 30 s old', () => {
    expect(isFresh(now, now)).toBe(true);
    expect(isFresh(now - 30_000, now)).toBe(true);
  });
  it('rejects older readings', () => {
    expect(isFresh(now - 30_001, now)).toBe(false);
  });
  it('tolerates small clock skew into the future but not large', () => {
    expect(isFresh(now + 5_000, now)).toBe(true);
    expect(isFresh(now + 30_001, now)).toBe(false);
  });
  it('rejects non-finite timestamps', () => {
    expect(isFresh(Number.NaN, now)).toBe(false);
  });
});

describe('accuracy gates', () => {
  it('lecturer may start only at ≤ 100 m', () => {
    expect(isPreciseEnoughToStart(100)).toBe(true);
    expect(isPreciseEnoughToStart(100.1)).toBe(false);
  });
  it('student readings are accepted only at ≤ 100 m', () => {
    expect(isPreciseEnoughToCheckIn(100)).toBe(true);
    expect(isPreciseEnoughToCheckIn(100.1)).toBe(false);
  });
  it('negative or non-finite accuracy is never accepted', () => {
    expect(isPreciseEnoughToStart(-1)).toBe(false);
    expect(isPreciseEnoughToCheckIn(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
