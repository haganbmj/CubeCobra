import { Dispatch, useEffect, useReducer, useRef } from 'react';

import { readRecord, writeRecord } from 'utils/localStorage/record';

/**
 * A reducer whose state is backed by a localStorage record.
 *
 * The point of a reducer rather than a set of stored values is single ownership. Every
 * mutation is an action applied to the state the reducer currently holds, so two mutations
 * dispatched in the same tick compose instead of the second one clobbering the first with a
 * snapshot captured before it.
 *
 * Seeding prefers the stored record and falls back to `init`. The record layer reports a
 * missing, corrupt, or foreign-version record identically — as nothing stored — so `init`
 * covers all of them.
 *
 * Persistence happens in an effect keyed on state rather than inside the returned dispatch:
 * dispatch stays the raw, stable one React gave us, and a batch of dispatches persists once,
 * with the state the reducer actually settled on. The cost is that the write lands a tick
 * after the render, which is fine for a cache that only has to survive a reload.
 *
 * `key` must be stable for the lifetime of the hook. The lazy initializer runs once, so a
 * changed key cannot re-seed state from the new key's record — and writing the old key's
 * state under the new one would clobber whatever that record holds. Nothing re-seeds here;
 * a caller that needs to switch keys should remount instead, e.g. via a React `key`.
 */
export const useStoredReducer = <S, A>(
  key: string,
  reducer: (state: S, action: A) => S,
  init: () => S,
): [S, Dispatch<A>] => {
  const [state, dispatch] = useReducer(reducer, key, (storageKey: string): S => {
    const record = readRecord<S>(storageKey);
    return record === null ? init() : record.data;
  });

  // Seeded state is already what storage holds (or all storage can offer), so tracking it
  // from the start keeps mount from writing. It also absorbs StrictMode's double-invoke of
  // the effect. It is not what skips a no-op dispatch: when the reducer returns the identical
  // reference React bails out, so `state` never changes and the effect simply does not re-run.
  const persisted = useRef<S>(state);

  useEffect(() => {
    if (persisted.current === state) {
      return;
    }
    // Recorded before the write because `writeRecord` swallows its own failures. A quota
    // error leaves the hook believing this state is on disk, which self-heals on the next
    // state change — acceptable for a best-effort cache, and cheaper than retry bookkeeping.
    persisted.current = state;
    writeRecord(key, state);
    // `key` is deliberately not a dependency: a key change alone must not republish state
    // that belongs to the previous key. See the stable-key contract above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return [state, dispatch];
};
