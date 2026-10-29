import type { DraftStore } from 'drafting/draftStore';
import { draftStoreFromLegacyKeys, draftStoreKey } from 'drafting/draftStore';
import type { StoredRecord } from 'utils/localStorage/record';
import { readRecord, RECORD_VERSION, removeRecord, writeRecord } from 'utils/localStorage/record';
import { familyOf, LEGACY_DRAFT_FAMILY_IDS } from 'utils/localStorage/registry';

/**
 * Migrates pre-record drafts and evicts stale keys, once per page load.
 *
 * ## The safety invariant
 *
 * Every key this module acts on is reached through `familyOf`. There is no pattern of the
 * reaper's own anywhere below, and no fallback branch: a key that matches no family in the
 * registry falls out of the loop untouched. That is load-bearing rather than tidy, because
 * this origin is shared — alongside our ~35 key families sit roughly 85 third-party
 * advertising identifiers (`_iiq_fdata_*`, `id5id*`, `33acrossId`, `np.history`, …) written
 * by scripts we do not control. Deleting one of those would be a far worse bug than the
 * storage leak this model exists to fix.
 *
 * ## Why migration runs first
 *
 * The five flat `localStorage` keys that `cc:draft:<id>` replaces carry no timestamp of any
 * kind, so their age can only be measured from `cc:meta.firstSeenAt` — a clock that starts on
 * the user's first load of this bundle and runs browser-wide. If migration were lazy (only
 * when the user reopens that particular draft), a draft last touched just before the upgrade
 * and not reopened within the week would be deleted at day 7, well inside its own 30-day TTL.
 * Migrating eagerly, for every legacy draft id in storage, closes that window: a just-migrated
 * draft is judged on its new record's `t` and gets the full TTL from the user's first load.
 *
 * The legacy keys are **copied, not deleted**. Leaving them costs a week of duplicated storage
 * and buys the rollback case — if the deploy is rolled back, the old bundle finds its keys
 * where it left them. They are cleaned up by the `grace` rule once the window has passed.
 *
 * Nothing in here throws. A failure to tidy storage must never stop a page rendering.
 */

/**
 * The reaper's own bookkeeping: the one timestamp that drives the `grace` clock.
 *
 * Deliberately claimed by no family in the registry, so the pass below cannot reach it. If it
 * ever could, the stamp would be deleted on the same schedule it measures and the legacy keys
 * would be granted a fresh week on every expiry.
 */
export const META_KEY = 'cc:meta';

interface ReaperMeta {
  firstSeenAt: number;
}

export interface ReapResult {
  /**
   * Keys the pass deleted. `removeRecord` swallows a storage failure rather than reporting it,
   * so on the rare browser that refuses the removal a key is still listed here.
   */
  removed: string[];
  /** Draft ids converted from flat legacy keys into a `cc:draft:` record by this call. */
  migrated: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const LEGACY_DRAFT_FAMILIES = new Set(LEGACY_DRAFT_FAMILY_IDS);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A snapshot of every key in storage, or null if there is no store we can reach.
 *
 * Guarded the way `record.ts` guards its own access: the client bundle is rendered server-side
 * where there is no window, and a browser that denies storage throws a SecurityError from the
 * accessor itself, before a method can be called. Neither is an anomaly worth logging.
 */
const snapshotKeys = (): string[] | null => {
  try {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return null;
    }
    return Object.keys(window.localStorage);
  } catch {
    return null;
  }
};

/**
 * The midnight-UTC instant a `keyDate` family's entity names, or null if it names no real day.
 *
 * The round-trip check is what makes an unreadable date safe. `Date.UTC` rolls overflow
 * forward, so `2026-13-45` would otherwise resolve to a plausible-looking day in February
 * 2027 — and a key the registry claims would be deleted on a guess about what it meant.
 */
const parseKeyDate = (entity: string | null): number | null => {
  if (entity === null) {
    return null;
  }

  const parts = ISO_DATE.exec(entity);
  if (parts === null) {
    return null;
  }

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const instant = Date.UTC(year, month - 1, day);
  const date = new Date(instant);

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return instant;
};

/**
 * When this browser first ran the reaper, stamping it if this is that first run.
 *
 * One record for the whole origin rather than metadata per key: the legacy keys cannot be
 * given a timestamp retroactively, and every one of them became stale at the same moment —
 * the deploy that stopped writing them.
 */
const firstSeenAt = (now: number): number => {
  const meta = readRecord<ReaperMeta>(META_KEY);

  if (meta !== null && typeof meta.data?.firstSeenAt === 'number') {
    return meta.data.firstSeenAt;
  }

  writeRecord<ReaperMeta>(META_KEY, { firstSeenAt: now });
  return now;
};

/** The distinct draft ids that have at least one legacy key, found only via the registry. */
const legacyDraftIds = (keys: string[]): string[] => {
  const ids = new Set<string>();

  for (const key of keys) {
    const family = familyOf(key);
    if (family === undefined || !LEGACY_DRAFT_FAMILIES.has(family.id)) {
      continue;
    }

    const draftId = family.entityOf(key);
    if (draftId !== null) {
      ids.add(draftId);
    }
  }

  return [...ids];
};

/**
 * Writes the migrated record stamped with the reaper's `now` rather than `writeRecord`'s own
 * `Date.now()`. The pass below measures a record's age against that same `now`, so a record
 * written off any other clock could be evicted by the very call that created it.
 */
const writeMigratedRecord = (key: string, store: DraftStore, now: number): boolean => {
  try {
    const record: StoredRecord<DraftStore> = { v: RECORD_VERSION, t: now, data: store };
    window.localStorage.setItem(key, JSON.stringify(record));
    return true;
  } catch (err) {
    // A full store must not abandon the eviction pass — that pass is what makes room.
    console.error(`Failed to migrate legacy draft keys into ${key}`, err);
    return false;
  }
};

export const reapLocalStorage = (now: number): ReapResult => {
  const result: ReapResult = { removed: [], migrated: [] };

  try {
    const keys = snapshotKeys();
    if (keys === null) {
      return result;
    }

    // Pass 0 — stamp the browser-wide clock the grace rule measures against, if this is the
    // first run on this browser.
    const since = firstSeenAt(now);

    // Pass 1 — migrate. Before anything is evicted, so that the grace rule below can never
    // delete a legacy key that was about to become a record.
    for (const draftId of legacyDraftIds(keys)) {
      const recordKey = draftStoreKey(draftId);

      // Once a record exists it wins; the legacy keys are never consulted again.
      if (readRecord<DraftStore>(recordKey) !== null) {
        continue;
      }

      // Null means no parseable `draftstate-`, so there is nothing resumable here whatever the
      // other four keys hold. Those strays are left to the grace rule.
      const store = draftStoreFromLegacyKeys(draftId);
      if (store === null) {
        continue;
      }

      if (writeMigratedRecord(recordKey, store, now)) {
        result.migrated.push(draftId);
      }
    }

    const remove = (key: string): void => {
      removeRecord(key);
      result.removed.push(key);
    };

    // Pass 2 — evict, dispatching on the family's declared lifetime. An unclaimed key reaches
    // none of these branches.
    for (const key of keys) {
      const family = familyOf(key);
      if (family === undefined) {
        continue;
      }

      const expiry = family.expiry;

      // User content and preferences, whose loss would be a regression rather than a cleanup.
      if (expiry === 'permanent') {
        continue;
      }

      // Written by a component that no longer reads it: pure residue.
      if (expiry === 'legacy') {
        remove(key);
        continue;
      }

      switch (expiry.kind) {
        case 'record': {
          // A record carries its own write time, so its age needs no external bookkeeping. A
          // null read is corrupt or from a schema version this code cannot interpret; either
          // way no reader can use it.
          const record = readRecord(key);
          if (record === null || now - record.t > expiry.ttlDays * DAY_MS) {
            remove(key);
          }
          break;
        }
        case 'keyDate': {
          const written = parseKeyDate(family.entityOf(key));
          if (written !== null && now - written > expiry.ttlDays * DAY_MS) {
            remove(key);
          }
          break;
        }
        case 'grace': {
          // Measured from this browser's first load of the new bundle, which is the only
          // timestamp these keys can be given.
          if (now - since > expiry.ttlDays * DAY_MS) {
            remove(key);
          }
          break;
        }
      }
    }
  } catch (err) {
    // Housekeeping failing is never a reason to stop a page rendering.
    console.error('Failed to reap localStorage', err);
  }

  return result;
};
