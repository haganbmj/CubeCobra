import { P1P1Pack } from '@utils/datatypes/P1P1Pack';

// Persistent client-side cache for P1P1 pack bodies, keyed by pack id.
//
// A pack's cards never change after it's generated - only `votesByUser` is mutable - so once a
// reader has fetched a pack once, the body can be served from IndexedDB on every later visit
// (another scroll past the same embed, or revisiting a primer). A hit buys three things: the pack
// body paints immediately instead of waiting on the network; the fetch doesn't count against the
// page's embed-fetch budget (`EmbedBudgetContext` bounds *fetches*, and a hit isn't one); and the
// request that still has to go out is the cheap one. `useP1P1Pack` routes a hit to
// `/tool/api/p1p1votes`, which answers from the pack's DynamoDB record alone and never touches S3,
// instead of `getp1p1`, which reads both halves. The DynamoDB gets remain either way - the pack
// record and its cube are still needed - but the S3 read is skipped entirely.
//
// A request is still unavoidable, because the vote summary can never be cached (below).
//
// The vote summary (`P1P1VoteSummary`, returned by `getp1p1` alongside `pack`) is never cached here
// and must always come from the network: it drives both the tile's call to action and whether
// results are shown, so a stale copy would show the wrong thing to someone who has since voted.
// `votesByUser` itself - the one mutable field on `P1P1Pack` - is stripped before a pack is ever
// written to the store, so even a direct read of the raw entry can't leak stale vote state.
//
// Each entry carries a `cachedAt` timestamp and expires after a day. That TTL is a pure backstop -
// nothing about a pack's identity is expected to change - rather than encoding any actual staleness
// rule, mirroring the one used for volatile card details in `cardDetailsCache.ts`.

const DB_NAME = 'cubecobra-p1p1-packs';
const DB_VERSION = 1;
const STORE = 'packs';
const TTL_MS = 24 * 60 * 60 * 1000;

type CachedPack = Omit<P1P1Pack, 'votesByUser'>;

interface CachedEntry {
  pack: CachedPack;
  cachedAt: number;
}

// Checked per call, not frozen at import time: IndexedDB can be unavailable (or become unavailable)
// independently of when this module first loaded.
const hasIndexedDB = (): boolean => typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

const isUsable = (entry: CachedEntry | undefined, now: number): entry is CachedEntry => {
  if (!entry || typeof entry.cachedAt !== 'number' || !entry.pack) return false;
  return now - entry.cachedAt <= TTL_MS;
};

let dbPromise: Promise<IDBDatabase> | null = null;
const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
};

const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export const readPack = async (id: string): Promise<P1P1Pack | null> => {
  if (!hasIndexedDB()) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const entry = (await wrap(tx.objectStore(STORE).get(id))) as CachedEntry | undefined;
    if (!isUsable(entry, Date.now())) return null;
    // `votesByUser` was stripped before this entry was ever written (see `writePack`) and nothing
    // on the client reads it off `pack` - votes always come from the network - so an empty map
    // satisfies the type without resurrecting any vote state.
    return { ...entry.pack, votesByUser: {} };
  } catch {
    return null;
  }
};

export const writePack = async (id: string, pack: P1P1Pack): Promise<void> => {
  if (!hasIndexedDB()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const { votesByUser: _votesByUser, ...rest } = pack;
    const entry: CachedEntry = { pack: rest, cachedAt: Date.now() };
    tx.objectStore(STORE).put(entry, id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // best-effort persistence; the caller's in-memory state is unaffected either way
  }
};
