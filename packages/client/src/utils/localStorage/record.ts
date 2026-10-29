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

/**
 * Resolves the store, or null if there isn't one we can touch.
 *
 * Two separate things can go wrong before a single method is called. The client bundle is
 * also rendered server-side, where there is no window — and bare `localStorage` is not a
 * reliable stand-in for that, since Node defines a non-functional global of its own. And
 * in a browser that denies storage — third-party cookies blocked, a sandboxed iframe —
 * merely *reading* the accessor throws a SecurityError, so even the guard goes in the try.
 */
const getStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return null;
    }
    return window.localStorage;
  } catch {
    // An unreachable store is an expected browser configuration, not an anomaly worth logging.
    return null;
  }
};

export const readRecord = <T>(key: string): StoredRecord<T> | null => {
  const storage = getStorage();
  if (storage === null) {
    return null;
  }

  let parsed: unknown;
  try {
    const raw = storage.getItem(key);
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

  // A well-formed envelope around nothing is not a record. Returning one would hand every
  // caller `data: undefined` to destructure, and — because the read did not fail — the
  // reaper would leave it in place, so the failure would repeat on every load.
  if (!('data' in record)) {
    return null;
  }

  return { v: record.v, t: record.t, data: record.data as T };
};

export const writeRecord = <T>(key: string, data: T): void => {
  const storage = getStorage();
  if (storage === null) {
    return;
  }

  try {
    const record: StoredRecord<T> = { v: RECORD_VERSION, t: Date.now(), data };
    storage.setItem(key, JSON.stringify(record));
  } catch (err) {
    // A full or unavailable store must not break the page that was only caching state.
    console.error(`Failed to write localStorage record ${key}`, err);
  }
};

export const removeRecord = (key: string): void => {
  const storage = getStorage();
  if (storage === null) {
    return;
  }

  try {
    storage.removeItem(key);
  } catch (err) {
    console.error(`Failed to remove localStorage record ${key}`, err);
  }
};
