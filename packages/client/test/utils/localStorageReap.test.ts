import type { DraftStore } from 'drafting/draftStore';
import { readRecord, RECORD_VERSION } from 'utils/localStorage/record';
import { familyOf } from 'utils/localStorage/registry';
import { META_KEY, reapLocalStorage } from 'utils/localStorage/reap';

const DAY = 24 * 60 * 60 * 1000;

/** An arbitrary but fixed "now" — midday on a date the puzzle fixtures below are written against. */
const T = Date.UTC(2026, 9, 28, 12, 0, 0);

/**
 * Seeds a record with a timestamp of our choosing. `writeRecord` stamps `Date.now()`, which a
 * test that reaps at an arbitrary `now` cannot control.
 */
const seedRecord = (key: string, data: unknown, t: number): void => {
  localStorage.setItem(key, JSON.stringify({ v: RECORD_VERSION, t, data }));
};

const LEGACY_KEYS_FOR_ABC = {
  'draftstate-abc': { step: 1 },
  'mainboard-abc': [[[1]]],
  'sideboard-abc': [[[2]]],
  'trashboard-abc': [3],
  'picks-abc': [4],
};

const seedLegacyDraftAbc = (): void => {
  for (const [key, value] of Object.entries(LEGACY_KEYS_FOR_ABC)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

describe('localStorage reaper', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('never touches a key no family claims', () => {
    // Roughly 85 third-party advertising keys share this origin. Deleting one would be a
    // worse bug than the storage leak the reaper exists to fix, so the pass is an allowlist.
    localStorage.setItem('_iiq_fdata_1312496403', '{"ad":"tech"}');
    localStorage.setItem('np.history', 'whatever');

    reapLocalStorage(10 * 365 * DAY);

    expect(localStorage.getItem('_iiq_fdata_1312496403')).toEqual('{"ad":"tech"}');
    expect(localStorage.getItem('np.history')).toEqual('whatever');
  });

  it('never touches a permanent family', () => {
    localStorage.setItem('cubecobra-changes-cube1', '{"mainboard":{}}');
    localStorage.setItem('cube1-blogpost', '"unsent writing"');
    localStorage.setItem('draftPackCardsPerRow', '4');

    reapLocalStorage(10 * 365 * DAY);

    expect(localStorage.getItem('cubecobra-changes-cube1')).toEqual('{"mainboard":{}}');
    expect(localStorage.getItem('cube1-blogpost')).toEqual('"unsent writing"');
    expect(localStorage.getItem('draftPackCardsPerRow')).toEqual('4');
  });

  it('removes a draft record past its ttl', () => {
    seedRecord('cc:draft:abc', { picks: [1] }, 0);

    const result = reapLocalStorage(31 * DAY);

    expect(localStorage.getItem('cc:draft:abc')).toBeNull();
    expect(result.removed).toContain('cc:draft:abc');
  });

  it('keeps a draft record within its ttl', () => {
    seedRecord('cc:draft:abc', { picks: [1] }, 0);

    const result = reapLocalStorage(29 * DAY);

    expect(readRecord<{ picks: number[] }>('cc:draft:abc')?.data).toEqual({ picks: [1] });
    expect(result.removed).toEqual([]);
  });

  it('removes an unparseable record', () => {
    // readRecord logs the parse failure, which would otherwise print to the test output.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('cc:draft:abc', 'not json');

    const result = reapLocalStorage(T);

    expect(localStorage.getItem('cc:draft:abc')).toBeNull();
    expect(result.removed).toContain('cc:draft:abc');
    expect(consoleError).toHaveBeenCalled();
  });

  it('removes a puzzle key whose date is past the ttl', () => {
    localStorage.setItem('manamatrix-2026-01-01', '{"guesses":[]}');

    const result = reapLocalStorage(T);

    expect(localStorage.getItem('manamatrix-2026-01-01')).toBeNull();
    expect(result.removed).toContain('manamatrix-2026-01-01');
  });

  it('keeps a puzzle key from today', () => {
    localStorage.setItem('manamatrix-2026-10-28', '{"guesses":[]}');

    reapLocalStorage(T);

    expect(localStorage.getItem('manamatrix-2026-10-28')).toEqual('{"guesses":[]}');
  });

  it('leaves a puzzle key with an unparseable date alone', () => {
    // Two different ways the date can be unreadable. `manamatrix-none` is claimed by no
    // family at all, so it is unreachable; `manamatrix-2026-13-45` *is* claimed — it is
    // date-shaped — but names no day, and the keyDate branch must not guess at one.
    localStorage.setItem('manamatrix-none', '{"guesses":[]}');
    localStorage.setItem('manamatrix-2026-13-45', '{"guesses":[]}');
    expect(familyOf('manamatrix-2026-13-45')?.expiry).toEqual({ kind: 'keyDate', ttlDays: 7 });

    reapLocalStorage(10 * 365 * DAY);

    expect(localStorage.getItem('manamatrix-none')).toEqual('{"guesses":[]}');
    expect(localStorage.getItem('manamatrix-2026-13-45')).toEqual('{"guesses":[]}');
  });

  it('migrates legacy draft keys it finds, even for a draft never reopened', () => {
    seedLegacyDraftAbc();

    const result = reapLocalStorage(T);

    const record = readRecord<DraftStore>('cc:draft:abc');
    expect(record?.t).toEqual(T);
    expect(record?.data).toEqual({
      state: { step: 1 },
      mainboard: [[[1]]],
      sideboard: [[[2]]],
      trashboard: [3],
      picks: [4],
    });
    expect(result.migrated).toEqual(['abc']);
    // Copied, not moved: a rollback to the previous bundle has to find its keys where it
    // left them.
    for (const key of Object.keys(LEGACY_KEYS_FOR_ABC)) {
      expect(localStorage.getItem(key)).not.toBeNull();
    }
  });

  it('gives a migrated draft a full ttl rather than the grace window', () => {
    seedLegacyDraftAbc();

    reapLocalStorage(T);
    const result = reapLocalStorage(T + 8 * DAY);

    // The grace clock has run out, so the legacy copies go...
    for (const key of Object.keys(LEGACY_KEYS_FOR_ABC)) {
      expect(localStorage.getItem(key)).toBeNull();
      expect(result.removed).toContain(key);
    }
    // ...but the record is judged on its own `t`, and 8 days is well inside its 30.
    expect(readRecord<DraftStore>('cc:draft:abc')?.data.picks).toEqual([4]);
  });

  it('does not overwrite an existing record when legacy keys also exist', () => {
    seedRecord('cc:draft:abc', { picks: [99] }, T);
    seedLegacyDraftAbc();

    const result = reapLocalStorage(T);

    expect(readRecord<{ picks: number[] }>('cc:draft:abc')?.data).toEqual({ picks: [99] });
    expect(result.migrated).toEqual([]);
  });

  it('stamps firstSeenAt on the first reap and keeps grace keys until it expires', () => {
    seedLegacyDraftAbc();

    reapLocalStorage(T);
    expect(readRecord<{ firstSeenAt: number }>(META_KEY)?.data).toEqual({ firstSeenAt: T });

    reapLocalStorage(T + 6 * DAY);
    expect(localStorage.getItem('draftstate-abc')).not.toBeNull();

    reapLocalStorage(T + 8 * DAY);
    expect(localStorage.getItem('draftstate-abc')).toBeNull();
    // The stamp is written once and reused, not refreshed on every pass.
    expect(readRecord<{ firstSeenAt: number }>(META_KEY)?.data).toEqual({ firstSeenAt: T });
  });

  it('leaves its own cc:meta to the grace clock, never to the pass', () => {
    // The registry deliberately does not claim cc:meta, so the pass cannot reach it. If it
    // ever did, the grace clock would reset itself and legacy keys would live forever.
    expect(familyOf(META_KEY)).toBeUndefined();

    reapLocalStorage(T);
    const result = reapLocalStorage(T + 10 * 365 * DAY);

    expect(readRecord<{ firstSeenAt: number }>(META_KEY)?.data).toEqual({ firstSeenAt: T });
    expect(result.removed).not.toContain(META_KEY);
  });

  it('leaves a legacy draft id with no draftstate key to the grace rule', () => {
    // Without `draftstate-` there is no resumable state, so there is nothing to migrate.
    localStorage.setItem('picks-orphan', '[4]');

    const first = reapLocalStorage(T);
    expect(first.migrated).toEqual([]);
    expect(localStorage.getItem('cc:draft:orphan')).toBeNull();
    expect(localStorage.getItem('picks-orphan')).toEqual('[4]');

    reapLocalStorage(T + 8 * DAY);
    expect(localStorage.getItem('picks-orphan')).toBeNull();
  });

  it('deletes a legacy family on sight', () => {
    localStorage.setItem('showDraftRatings-abc', 'true');

    const result = reapLocalStorage(T);

    expect(localStorage.getItem('showDraftRatings-abc')).toBeNull();
    expect(result.removed).toContain('showDraftRatings-abc');
  });

  it('does not throw when storage removal fails', () => {
    // removeRecord logs the failure, which would otherwise print to the test output.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('showDraftRatings-abc', 'true');
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(() => reapLocalStorage(T)).not.toThrow();
    expect(consoleError).toHaveBeenCalled();
  });
});
