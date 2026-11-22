import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_M, haversineM } from '../../shared/geo';

describe('haversineM', () => {
  it('returns 0 for identical points', () => {
    const p = { lat: 32.0853, lng: 34.7818 };
    expect(haversineM(p, p)).toBe(0);
  });

  it('is symmetric', () => {
    const a = { lat: 32.0853, lng: 34.7818 };
    const b = { lat: 31.7683, lng: 35.2137 };
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 6);
  });

  it('measures one degree of latitude as R·π/180', () => {
    const d = haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeCloseTo((EARTH_RADIUS_M * Math.PI) / 180, 3);
  });

  it('is accurate at classroom scale (0.0001° lat ≈ 11.12 m)', () => {
    const d = haversineM({ lat: 32.1, lng: 34.8 }, { lat: 32.1001, lng: 34.8 });
    expect(d).toBeCloseTo(11.12, 2);
  });

  it('shrinks longitude distance with latitude (cos φ)', () => {
    const atEquator = haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 });
    const at60 = haversineM({ lat: 60, lng: 0 }, { lat: 60, lng: 0.001 });
    expect(at60 / atEquator).toBeCloseTo(0.5, 3);
  });

  it('handles antipodal points without NaN', () => {
    const d = haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
    expect(d).toBeCloseTo(Math.PI * EARTH_RADIUS_M, 0);
  });
});
