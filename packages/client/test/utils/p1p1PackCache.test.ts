import { P1P1Pack } from '@utils/datatypes/P1P1Pack';

// Jest's jsdom test environment doesn't forward Node's global `structuredClone` into the jsdom
// realm (the same reason `fetch` has to be stubbed by hand elsewhere in this suite), but
// fake-indexeddb needs it to clone values on write. A JSON round-trip is a faithful enough clone for
// the plain, JSON-safe pack data these tests write.
if (typeof structuredClone === 'undefined') {
  (globalThis as any).structuredClone = (value: unknown) => JSON.parse(JSON.stringify(value));
}

// p1p1PackCache is a thin IndexedDB wrapper, so it needs a real (fake) IndexedDB implementation to
// exercise - jsdom itself has none. Imported before the module under test so `window.indexedDB`
// exists from the start; the module checks for it on every call rather than freezing the answer at
// import time (see the "unavailable" test below, which deletes it mid-suite).
import 'fake-indexeddb/auto';

import { readPack, writePack } from 'utils/p1p1PackCache';

const DB_NAME = 'cubecobra-p1p1-packs';
const STORE = 'packs';

const makePack = (id: string, overrides?: Partial<P1P1Pack>): P1P1Pack => ({
  id,
  createdBy: 'user-1',
  cubeId: 'cube-1',
  date: 1700000000000,
  votesByUser: { 'user-1': 2 },
  cards: [{ name: 'Test Card' } as any],
  createdByUsername: 'dekkerglen',
  seed: 'seed',
  source: 'random',
  ...overrides,
});

// Reads the raw stored entry directly, bypassing `readPack`'s own TTL/shape handling, so the "never
// stores vote state" test can check what actually landed in IndexedDB rather than what `readPack`
// reconstructs from it.
const rawEntry = (id: string): Promise<any> =>
  new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE, 'readonly');
      const getReq = tx.objectStore(STORE).get(id);
      getReq.onsuccess = () => resolve(getReq.result);
      getReq.onerror = () => reject(getReq.error);
    };
    req.onerror = () => reject(req.error);
  });

describe('p1p1PackCache', () => {
  it('returns a written pack', async () => {
    const pack = makePack('pack-written');
    await writePack(pack.id, pack);

    const result = await readPack(pack.id);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(pack.id);
    expect(result?.cards).toEqual(pack.cards);
    expect(result?.seed).toBe(pack.seed);
  });

  it('returns null for an unknown id', async () => {
    const result = await readPack('pack-never-written');

    expect(result).toBeNull();
  });

  it('drops an entry past its TTL', async () => {
    const pack = makePack('pack-ttl');
    const writtenAt = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(writtenAt);
    try {
      await writePack(pack.id, pack);
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }

    // One day (the cache's TTL backstop) plus a second, so the entry is unambiguously expired.
    jest.spyOn(Date, 'now').mockReturnValue(writtenAt + 24 * 60 * 60 * 1000 + 1000);
    try {
      const result = await readPack(pack.id);
      expect(result).toBeNull();
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }
  });

  it('never stores vote state', async () => {
    const pack = makePack('pack-votes', { votesByUser: { 'user-1': 0, 'user-2': 1 } });

    await writePack(pack.id, pack);

    const raw = await rawEntry(pack.id);
    expect(raw.pack).not.toHaveProperty('votesByUser');
  });

  it('resolves to null rather than throwing when IndexedDB is unavailable', async () => {
    const original = window.indexedDB;
    // @ts-expect-error - simulating an environment without IndexedDB support
    delete window.indexedDB;

    try {
      await expect(readPack('pack-no-idb')).resolves.toBeNull();
      await expect(writePack('pack-no-idb', makePack('pack-no-idb'))).resolves.toBeUndefined();
    } finally {
      window.indexedDB = original;
    }
  });
});
