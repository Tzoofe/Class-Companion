export interface LocationBody {
  lat: number;
  lng: number;
  accuracy: number;
}

/** Validates {lat, lng, accuracy} from a request body; returns null if malformed. */
export function readLocation(body: unknown): LocationBody | null {
  const { lat, lng, accuracy } = (body ?? {}) as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number' || typeof accuracy !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(accuracy)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || accuracy < 0) return null;
  return { lat, lng, accuracy };
}

export interface ReadingBody extends LocationBody {
  timestamp: number;
}

/** Validates {lat, lng, accuracy, timestamp} (timestamp = device epoch ms). */
export function readReading(body: unknown): ReadingBody | null {
  const loc = readLocation(body);
  const { timestamp } = (body ?? {}) as Record<string, unknown>;
  if (!loc || typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
  return { ...loc, timestamp };
}
