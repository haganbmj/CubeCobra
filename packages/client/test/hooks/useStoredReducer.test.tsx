import { act, renderHook } from '@testing-library/react';

import { useStoredReducer } from 'hooks/useStoredReducer';
import { RECORD_VERSION, readRecord, writeRecord } from 'utils/localStorage/record';

interface Counter {
  count: number;
}

type CounterAction = { type: 'inc' } | { type: 'noop' };

// A no-op action returns the identical state reference, which is how a reducer tells the
// hook that nothing worth persisting happened.
const reducer = (state: Counter, action: CounterAction): Counter =>
  action.type === 'inc' ? { count: state.count + 1 } : state;

const KEY = 'cc:test:counter';
const OTHER_KEY = 'cc:test:other-counter';

describe('useStoredReducer', () => {
  beforeEach(() => {
    localStorage.clear();
    // Every write gets a distinct timestamp, so an unchanged stored `t` proves no write
    // happened rather than only proving two writes landed in the same millisecond.
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => {
      now += 1_000;
      return now;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('seeds from init when nothing is stored', () => {
    const init = jest.fn((): Counter => ({ count: 5 }));

    const { result } = renderHook(() => useStoredReducer(KEY, reducer, init));

    expect(result.current[0]).toEqual({ count: 5 });
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('seeds from the stored record when one exists', () => {
    writeRecord(KEY, { count: 7 });
    const init = jest.fn((): Counter => ({ count: 0 }));

    const { result } = renderHook(() => useStoredReducer(KEY, reducer, init));

    expect(result.current[0]).toEqual({ count: 7 });
    expect(init).not.toHaveBeenCalled();
  });

  it('persists after a dispatch', () => {
    const { result } = renderHook(() => useStoredReducer(KEY, reducer, () => ({ count: 0 })));

    act(() => result.current[1]({ type: 'inc' }));

    expect(result.current[0]).toEqual({ count: 1 });
    expect(readRecord<Counter>(KEY)?.data).toEqual({ count: 1 });
  });

  it('composes two dispatches in the same tick', () => {
    const { result } = renderHook(() => useStoredReducer(KEY, reducer, () => ({ count: 0 })));
    const dispatch = result.current[1];

    // Both calls come from one render's snapshot, which is the shape the draft page used to
    // clobber itself with: a second mutation built from state captured before the first.
    act(() => {
      dispatch({ type: 'inc' });
      dispatch({ type: 'inc' });
    });

    expect(result.current[0]).toEqual({ count: 2 });
    expect(readRecord<Counter>(KEY)?.data).toEqual({ count: 2 });
  });

  it('does not write when the reducer returns the same state', () => {
    const { result } = renderHook(() => useStoredReducer(KEY, reducer, () => ({ count: 0 })));
    act(() => result.current[1]({ type: 'inc' }));
    const persisted = readRecord<Counter>(KEY);
    expect(persisted).toEqual({ v: RECORD_VERSION, t: expect.any(Number), data: { count: 1 } });

    act(() => result.current[1]({ type: 'noop' }));

    expect(readRecord<Counter>(KEY)).toEqual(persisted);
  });

  it('does not write the previous key\u2019s state under a changed key', () => {
    writeRecord(OTHER_KEY, { count: 99 });
    const untouched = readRecord<Counter>(OTHER_KEY);
    const { result, rerender } = renderHook(
      ({ storageKey }) => useStoredReducer(storageKey, reducer, () => ({ count: 0 })),
      { initialProps: { storageKey: KEY } },
    );
    act(() => result.current[1]({ type: 'inc' }));

    // `key` is documented as fixed for the hook's lifetime; changing it must not be
    // destructive. State belongs to the old key, so it has no business being stamped
    // onto whatever the new key already holds.
    rerender({ storageKey: OTHER_KEY });

    expect(readRecord<Counter>(OTHER_KEY)).toEqual(untouched);
    expect(readRecord<Counter>(KEY)?.data).toEqual({ count: 1 });
  });

  it('still dispatches when persistence throws', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    const { result } = renderHook(() => useStoredReducer(KEY, reducer, () => ({ count: 0 })));

    expect(() => act(() => result.current[1]({ type: 'inc' }))).not.toThrow();

    expect(result.current[0]).toEqual({ count: 1 });
    expect(consoleError).toHaveBeenCalled();
  });
});
