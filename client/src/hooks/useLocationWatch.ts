import { useEffect, useState } from 'react';

export interface Reading {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export interface LocationWatch {
  latest: Reading | null;
  /** Lowest-accuracy reading since the page opened. */
  best: Reading | null;
  /** Lowest-accuracy reading within the last `windowMs` (falls back to the latest one). */
  recentBest: Reading | null;
  count: number;
  error: string | null;
  /** The browser refused access to location (permission denied). */
  denied: boolean;
}

const ERROR_TEXT: Record<number, string> = {
  1: 'הגישה למיקום נחסמה. אפשרו מיקום (ומיקום מדויק) עבור הדפדפן בהגדרות.',
  2: 'לא ניתן לקבוע מיקום כרגע.',
  3: 'תם הזמן לקבלת מיקום.',
};

const lowest = (rs: Reading[]) => rs.reduce<Reading | null>((b, r) => (!b || r.accuracy < b.accuracy ? r : b), null);

/**
 * Continuously watches the device position with high accuracy.
 * `recentBest` implements "best reading of the last ~10 s" so a stale precise
 * reading is not used after the device moved.
 */
export function useLocationWatch(windowMs = 10_000): LocationWatch {
  const [state, setState] = useState<LocationWatch & { recent: Reading[] }>({
    latest: null,
    best: null,
    recentBest: null,
    recent: [],
    count: 0,
    error: null,
    denied: false,
  });

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, error: 'הדפדפן לא תומך במיקום.' }));
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const r: Reading = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        };
        setState((s) => {
          const recent = [...s.recent, r].filter((x) => r.timestamp - x.timestamp <= windowMs);
          return {
            latest: r,
            best: !s.best || r.accuracy < s.best.accuracy ? r : s.best,
            recentBest: lowest(recent),
            recent,
            count: s.count + 1,
            error: null,
            denied: false,
          };
        });
      },
      (err) => setState((s) => ({ ...s, error: ERROR_TEXT[err.code] ?? err.message, denied: err.code === 1 })),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [windowMs]);

  return state;
}
