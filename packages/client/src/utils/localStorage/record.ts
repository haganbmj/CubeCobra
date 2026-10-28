/**
 * A tiny versioned, timestamped wrapper around localStorage.
 *
 * Every record carries the schema version it was written under and the time it was
 * written, so later readers can tell stale or foreign data from current data without
 * the caller having to track either.
 *
 * Nothing in here throws. Callers treat an unreadable record exactly like an absent
 * one — their fallback for "nothing stored yet" (build fresh state) is also the right
 * answer for "stored, but corrupt or from a version this code cannot interpret".
 */

export const RECORD_VERSION = 1;

export interface StoredRecord<T> {
  v: number;
  t: number;
  data: T;
}

// The client bundle is also rendered server-side, where there is no localStorage at all.
const storageUnavailable = (): boolean => typeof localStorage === 'undefined';

export const readRecord = <T>(key: string): StoredRecord<T> | null => {
  if (storageUnavailable()) {
    return null;
  }

  let parsed: unknown;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return null;
    }
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to read localStorage record ${key}`, err);
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const record = parsed as Partial<StoredRecord<T>>;
  // A record written under a different version of this schema is not ours to interpret.
  if (record.v !== RECORD_VERSION || typeof record.t !== 'number') {
    return null;
  }

  return { v: record.v, t: record.t, data: record.data as T };
};

export const writeRecord = <T>(key: string, data: T): void => {
  if (storageUnavailable()) {
    return;
  }

  try {
    const record: StoredRecord<T> = { v: RECORD_VERSION, t: Date.now(), data };
    localStorage.setItem(key, JSON.stringify(record));
  } catch (err) {
    // A full or unavailable store must not break the page that was only caching state.
    console.error(`Failed to write localStorage record ${key}`, err);
  }
};

export const removeRecord = (key: string): void => {
  if (storageUnavailable()) {
    return;
  }

  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.error(`Failed to remove localStorage record ${key}`, err);
  }
};
