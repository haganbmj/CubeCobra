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
  // from the start keeps mount from writing, and makes a reducer that returned its state
  // unchanged skip the write too.
  const persisted = useRef<{ key: string; state: S }>({ key, state });

  useEffect(() => {
    if (persisted.current.key === key && persisted.current.state === state) {
      return;
    }
    persisted.current = { key, state };
    writeRecord(key, state);
  }, [key, state]);

  return [state, dispatch];
};
