/**
 * An inventory of every `localStorage` key family the CubeCobra client writes.
 *
 * This module is the only place that records what the application leaves on a visitor's
 * machine, and for how long. It is pure data plus a lookup — it never touches storage.
 *
 * ## The safety invariant
 *
 * The reaper that consumes this registry is an **allowlist**. A key that matches no family
 * here is never touched. That matters because this origin is shared: alongside our ~35 key
 * families sit roughly 85 third-party advertising identifiers (`_iiq_fdata_*`, `id5id*`,
 * `33acrossId`, `np.history`, …) written by scripts we do not control. Deleting one of those
 * would be a far worse bug than the storage leak this model exists to fix. So every pattern
 * below is anchored at both ends and narrow enough that it cannot reach past its own family.
 *
 * Two deliberate omissions:
 *
 * - `cc:meta` is the reaper's own bookkeeping (the browser-wide `firstSeenAt` that drives the
 *   `grace` clock). It is owned by the reaper, not described here, and `familyOf` must not
 *   claim it.
 * - No family claims bare `cc:` keys generally. The `cc:` namespace is reserved for this
 *   storage model, but only the families declared below are actually ours to manage.
 */

/**
 * How long a family's keys live, and where their age comes from.
 *
 * - `permanent` — never reaped. User content or a preference whose loss would be a regression.
 * - `legacy` — no code reads it any more; delete on sight.
 * - `record` — a `cc:` record carrying its own write time in `t`; age comes from that field.
 * - `keyDate` — the key itself ends in an ISO date; age comes from parsing the key, with no
 *   stored metadata at all.
 * - `grace` — a legacy family deliberately kept alive for a rollback window. These keys carry
 *   no timestamp of any kind, so their age is measured from the reaper's `cc:meta.firstSeenAt`.
 */
export type Expiry =
  | 'permanent'
  | 'legacy'
  | { kind: 'record'; ttlDays: number }
  | { kind: 'keyDate'; ttlDays: number }
  | { kind: 'grace'; ttlDays: number };

export interface KeyFamily {
  /** Stable identifier. By construction this is the family's literal pattern, so it is unique. */
  id: string;
  /** Anchored, non-global pattern. Capture group 1 is the entity id, where the family has one. */
  match: RegExp;
  /** Builds a concrete key. Exact families ignore the argument and return their single key. */
  key: (entityId: string) => string;
  /** The entity a key belongs to — a draft id, a cube id, a date — or `null` for exact families. */
  entityOf: (key: string) => string | null;
  expiry: Expiry;
  /** What the key holds and which component writes it. Documentation, not decoration. */
  note: string;
}

const escapeForPattern = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `prefix` + entity, e.g. `draftstate-<draftId>`.
 *
 * `entityPattern` defaults to "anything non-empty". The puzzle families narrow it to an ISO
 * date so that `synergyconnect-` cannot reach `synergyconnect-seen-help`, which is a global
 * preference belonging to a different family with a different lifetime.
 */
const prefixFamily = (prefix: string, expiry: Expiry, note: string, entityPattern = '.+'): KeyFamily => {
  const match = new RegExp(`^${escapeForPattern(prefix)}(${entityPattern})$`);
  return {
    id: prefix,
    match,
    key: (entityId: string) => `${prefix}${entityId}`,
    entityOf: (key: string) => match.exec(key)?.[1] ?? null,
    expiry,
    note,
  };
};

/**
 * Entity + `suffix`, e.g. `<cubeId>-blogpost`. Seven per-cube families are shaped this way,
 * which is why a prefix-only registry could not describe what the client actually writes.
 */
const suffixFamily = (suffix: string, expiry: Expiry, note: string): KeyFamily => {
  const match = new RegExp(`^(.+)${escapeForPattern(suffix)}$`);
  return {
    id: suffix,
    match,
    key: (entityId: string) => `${entityId}${suffix}`,
    entityOf: (key: string) => match.exec(key)?.[1] ?? null,
    expiry,
    note,
  };
};

/** A single literal key with no entity, e.g. `cubeTrayCombos`. */
const exactFamily = (literal: string, expiry: Expiry, note: string): KeyFamily => ({
  id: literal,
  match: new RegExp(`^${escapeForPattern(literal)}$`),
  key: () => literal,
  entityOf: () => null,
  expiry,
  note,
});

const ISO_DATE = '\\d{4}-\\d{2}-\\d{2}';

/**
 * Declared least-destructive first: `permanent`, then `record`, `keyDate`, `grace`, and finally
 * `legacy`. `familyOf` returns the first match, so if a pattern were ever widened by accident
 * the ambiguity would resolve towards keeping data rather than deleting it.
 *
 * That ordering is load-bearing, not decorative — it is the only thing that decides which way
 * an accidental overlap falls, and the registry test asserts that every `permanent` family
 * stays ahead of every family with a lifetime. No two patterns below claim the same key today,
 * which the same test also proves; the ordering is what protects the day one of them does.
 */
export const FAMILIES: KeyFamily[] = [
  // ---------------------------------------------------------------------------------------
  // Global preferences. One key each, shared across every cube and page.
  // ---------------------------------------------------------------------------------------
  exactFamily(
    'showcustomimages',
    'permanent',
    'DisplayContext: whether user-uploaded custom card art is shown in place of Scryfall art.',
  ),
  exactFamily('cardsPerRow', 'permanent', 'DisplayContext: how many cards a grid view fits per row.'),
  exactFamily('stacksPerRow', 'permanent', 'DisplayContext: how many stacks a stacked view fits per row.'),
  exactFamily('cubeSidebarExpanded', 'permanent', 'DisplayContext: whether the cube sidebar starts expanded.'),
  exactFamily('rightSidebarPosition', 'permanent', 'DisplayContext: which side the secondary sidebar docks to.'),
  exactFamily(
    'show-deckbuilder-stats',
    'permanent',
    'DisplayContext: deckbuilder stats panel visibility. Stored as a bare "true"/"false" string rather than JSON — it is the one preference written through raw setItem instead of useLocalStorage.',
  ),
  exactFamily('draftPackCardsPerRow', 'permanent', 'Pack: how many cards a draft pack lays out per row.'),
  exactFamily('listViewPageSize', 'permanent', 'ListView: rows per page in the cube list table.'),
  exactFamily('listViewColumns', 'permanent', 'ListView: which columns the cube list table shows.'),
  exactFamily('packageAddAutoTag', 'permanent', 'usePackageAddOptions: tag cards with the package name when adding.'),
  exactFamily(
    'packageAddUseDefaultPrinting',
    'permanent',
    "usePackageAddOptions: add a package's cards using the cube's default printing rather than the package's.",
  ),
  exactFamily('selectedBoardForATCModal', 'permanent', 'AddToCubeModal: the board last chosen when adding a card.'),
  exactFamily(
    'addGroupToCubeCreateBlogPost',
    'permanent',
    'AddGroupToCubeModal: whether adding a group of cards also creates a blog post.',
  ),
  exactFamily(
    'addGroupToCubeAddNotes',
    'permanent',
    'AddGroupToCubeModal: whether adding a group of cards records per-card notes.',
  ),
  exactFamily(
    'winrate-analytics-show-removed',
    'permanent',
    'WinrateAnalytics: include cards no longer in the cube in the winrate table.',
  ),
  exactFamily(
    'synergyconnect-seen-help',
    'permanent',
    'SynergyConnectPage: the help dialog has been shown once. Shares a prefix with the dated synergyconnect- puzzle family, which is why that family requires a date-shaped suffix.',
  ),
  exactFamily('cubeTrayCombos', 'permanent', 'CubeTrayContext: combos the user has pinned to the card tray.'),

  // ---------------------------------------------------------------------------------------
  // Per-cube state, keyed by cube id as a suffix.
  // ---------------------------------------------------------------------------------------
  suffixFamily(
    '-blogpost',
    'permanent',
    'EditCollapse / CubeListEditSidebar / BulkUploadPage: the body of a blog post drafted but not yet submitted. Unsent user writing — reaping it is an explicit non-goal.',
  ),
  suffixFamily(
    '-blogtitle',
    'permanent',
    'EditCollapse / CubeListEditSidebar / BulkUploadPage: the title of a blog post drafted but not yet submitted.',
  ),
  suffixFamily(
    '-specifyEdition',
    'permanent',
    'EditCollapse / CubeListEditSidebar: whether card edits pin a specific printing.',
  ),
  suffixFamily(
    '-showExtras',
    'permanent',
    'CubeListEditSidebar: whether the edit autocomplete offers extra printings.',
  ),
  suffixFamily('-editBoard', 'permanent', 'CubeListEditSidebar: which board (mainboard/maybeboard) edits target.'),
  suffixFamily('-useMaybeboard', 'permanent', 'EditCollapse: which board the edit controls are currently acting on.'),
  suffixFamily('-useBlog', 'permanent', "CubeContext: whether saving cube changes also posts to the cube's blog."),

  // ---------------------------------------------------------------------------------------
  // Per-entity state, keyed by a prefix.
  // ---------------------------------------------------------------------------------------
  prefixFamily(
    'cubecobra-changes-',
    'permanent',
    'ChangesContext: unsaved edits to a cube, keyed by cube id. This is unsubmitted user work that may sit untouched for months; never reaping it is an explicit non-goal of the eviction model.',
  ),
  prefixFamily(
    'cube-hero-collapsed-',
    'permanent',
    'CubeHero: whether the cube header is collapsed, keyed by the active tab link.',
  ),
  prefixFamily(
    'upgradePrompt:',
    'permanent',
    'UpgradePrompt: when a given prompt was dismissed, keyed by prompt. Expiring this would re-nag a user who already said no, which is a regression rather than a cleanup.',
  ),

  // ---------------------------------------------------------------------------------------
  // The consolidated draft record — the one family this storage model introduces.
  // ---------------------------------------------------------------------------------------
  prefixFamily(
    'cc:draft:',
    { kind: 'record', ttlDays: 30 },
    'The whole of an in-progress draft (state, mainboard, sideboard, trashboard, picks) in one versioned record, keyed by draft id. Carries its own write time in t, so its age needs no external bookkeeping. Removed explicitly when the draft is finished; the TTL only catches drafts the user abandoned.',
  ),

  // ---------------------------------------------------------------------------------------
  // Daily puzzles. The key's own trailing date is the only record of when it was written.
  // ---------------------------------------------------------------------------------------
  prefixFamily(
    'manamatrix-',
    { kind: 'keyDate', ttlDays: 7 },
    "ManaMatrixPage: an anonymous solver's progress on a dated Mana Matrix puzzle. Only the current day's puzzle is reachable, so anything older is unreferenced.",
    ISO_DATE,
  ),
  prefixFamily(
    'synergyconnect-',
    { kind: 'keyDate', ttlDays: 7 },
    "SynergyConnectPage: an anonymous solver's progress on a dated Synergy Connect board.",
    ISO_DATE,
  ),
  prefixFamily(
    'crossword-',
    { kind: 'keyDate', ttlDays: 7 },
    'CrosswordPage: the letters typed into a dated crossword, kept client-side so there is no request per keystroke.',
    ISO_DATE,
  ),

  // ---------------------------------------------------------------------------------------
  // The five flat keys cc:draft: replaces. Copied, not deleted, at migration, so that a
  // rollback to the previous bundle finds in-progress drafts where it left them. They are
  // removed by the grace rule once the rollback window has passed — or by the draft page as
  // soon as the draft is submitted, since no bundle should resume a draft the server owns.
  // ---------------------------------------------------------------------------------------
  prefixFamily(
    'draftstate-',
    { kind: 'grace', ttlDays: 7 },
    'Legacy: the draft engine state (seats, packs, step) for a draft id. Now cc:draft:<id>.data.state.',
  ),
  prefixFamily(
    'mainboard-',
    { kind: 'grace', ttlDays: 7 },
    'Legacy: the deck grid of a draft in progress. Now cc:draft:<id>.data.mainboard.',
  ),
  prefixFamily(
    'sideboard-',
    { kind: 'grace', ttlDays: 7 },
    'Legacy: the sideboard grid of a draft in progress. Now cc:draft:<id>.data.sideboard.',
  ),
  prefixFamily(
    'trashboard-',
    { kind: 'grace', ttlDays: 7 },
    'Legacy: cards trashed during a draft. Now cc:draft:<id>.data.trashboard.',
  ),
  prefixFamily(
    'picks-',
    { kind: 'grace', ttlDays: 7 },
    "Legacy: the user's picks in pick order, as POSTed to /draft/finish. Now cc:draft:<id>.data.picks.",
  ),

  // ---------------------------------------------------------------------------------------
  // Written by a component that no longer reads it.
  // ---------------------------------------------------------------------------------------
  prefixFamily(
    'showDraftRatings-',
    'legacy',
    'Whether DecksPickBreakdown showed bot ratings for a given draft. The per-draft reader is replaced by a user-level setting, so these keys are written by no one and read by no one — they are pure residue from every draft the user ever reviewed.',
  ),
];

/**
 * The family of a key, or `undefined` if no family claims it.
 *
 * `undefined` is the common case and the safe one: it means "not ours, do not touch". Note
 * that there is no catch-all branch and no `cc:`-wide fallback, so `cc:meta` and every
 * third-party key on the origin fall through to `undefined` by construction.
 */
export const familyOf = (key: string): KeyFamily | undefined => FAMILIES.find((family) => family.match.test(key));

/**
 * The legacy draft families, in the order a migration should read them. Task 8's reaper
 * iterates these to find draft ids that have flat keys but no `cc:draft:` record yet.
 */
export const LEGACY_DRAFT_FAMILY_IDS: string[] = ['draftstate-', 'mainboard-', 'sideboard-', 'trashboard-', 'picks-'];

/**
 * The five legacy keys belonging to one draft id.
 *
 * Built from the families declared above rather than from the prefixes spelled out a second
 * time, so a caller that clears these keys and the reaper that claims them cannot drift.
 */
export const legacyDraftKeys = (draftId: string): string[] =>
  LEGACY_DRAFT_FAMILY_IDS.map((id) => FAMILIES.find((family) => family.id === id)?.key(draftId)).filter(
    (key): key is string => key !== undefined,
  );
