import { useEffect, useState } from 'react';

export interface Reading {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export interface LocationWatch {
  latest: Reading | null;
  /** Reading with the lowest accuracy value seen so far. */
  best: Reading | null;
  count: number;
  error: string | null;
}

const ERROR_TEXT: Record<number, string> = {
  1: 'הגישה למיקום נחסמה. אפשרו מיקום (ומיקום מדויק) עבור הדפדפן בהגדרות.',
  2: 'לא ניתן לקבוע מיקום כרגע.',
  3: 'תם הזמן לקבלת מיקום.',
};

/** Continuously watches the device position with high accuracy. */
export function useLocationWatch(): LocationWatch {
  const [state, setState] = useState<LocationWatch>({
    latest: null,
    best: null,
    count: 0,
    error: null,
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
        setState((s) => ({
          latest: r,
          best: !s.best || r.accuracy < s.best.accuracy ? r : s.best,
          count: s.count + 1,
          error: null,
        }));
      },
      (err) => setState((s) => ({ ...s, error: ERROR_TEXT[err.code] ?? err.message })),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  return state;
}
