import { FAMILIES, familyOf, LEGACY_DRAFT_FAMILY_IDS } from 'utils/localStorage/registry';

/**
 * One sample key per row of the design's §4 table, in table order. This list is the
 * contract: if the client grows a new key family, this list and the registry grow
 * together or the last test fails.
 */
const SAMPLE_KEYS = [
  // The consolidated draft record.
  'cc:draft:7f3c9b2e-0a4d-4f1e-9f0b-1c2d3e4f5a6b',
  // Daily puzzles, keyed by the puzzle's date.
  'manamatrix-2026-10-28',
  'synergyconnect-2026-10-28',
  'crossword-2026-10-28',
  // The five legacy draft keys the record replaces.
  'draftstate-7f3c9b2e',
  'mainboard-7f3c9b2e',
  'sideboard-7f3c9b2e',
  'trashboard-7f3c9b2e',
  'picks-7f3c9b2e',
  // A reader that no longer exists.
  'showDraftRatings-7f3c9b2e',
  // Unsaved cube edits.
  'cubecobra-changes-cube123',
  // Unsubmitted blog text.
  'cube123-blogpost',
  'cube123-blogtitle',
  // Per-cube UI preferences.
  'cube123-specifyEdition',
  'cube123-showExtras',
  'cube123-editBoard',
  'cube123-useMaybeboard',
  'cube123-useBlog',
  // Per-tab hero collapse.
  'cube-hero-collapsed-overview',
  // Prompt dismissals.
  'upgradePrompt:draftSimulator',
  // Global preferences.
  'showcustomimages',
  'cardsPerRow',
  'stacksPerRow',
  'cubeSidebarExpanded',
  'rightSidebarPosition',
  'show-deckbuilder-stats',
  'draftPackCardsPerRow',
  'listViewPageSize',
  'listViewColumns',
  'packageAddAutoTag',
  'packageAddUseDefaultPrinting',
  'selectedBoardForATCModal',
  'addGroupToCubeCreateBlogPost',
  'addGroupToCubeAddNotes',
  'winrate-analytics-show-removed',
  'synergyconnect-seen-help',
  'cubeTrayCombos',
];

/**
 * Keys the registry must never claim. Three groups:
 *
 * 1. Third-party advertising identifiers that share the origin. Deleting one of these would
 *    be a worse bug than the leak this model fixes, so the allowlist has to miss them all.
 * 2. The reaper's own `cc:meta` bookkeeping, and `cc:` keys in general — the namespace is
 *    reserved for this model, but only the declared families are ours to manage.
 * 3. Near misses of our own patterns: an entity-less key, a suffix with nothing in front of
 *    it, and a prefix with nothing after it. None of those is a key the client ever writes.
 */
const FOREIGN_KEYS = [
  '_iiq_fdata_1312496403',
  'id5id',
  'id5id_last',
  '33acrossId',
  'np.history',
  '_pubcid',
  '_cc_id',
  '_sharedid',
  'panoramaId',
  'cto_bundle',
  'permutive-id',
  '__tld__',
  'pbjs_userId',
  'cc:meta',
  'cc:somethingElse',
  'cc:draft:',
  'draftstate-',
  'picks-',
  '-blogpost',
  'blogpost',
  'mainboard',
  'showDraftRatings',
];

describe('localStorage key registry', () => {
  it('matches the consolidated draft record', () => {
    const family = familyOf('cc:draft:abc');

    expect(family?.expiry).toEqual({ kind: 'record', ttlDays: 30 });
    expect(family?.entityOf('cc:draft:abc')).toEqual('abc');
  });

  it('matches a legacy draft key as grace', () => {
    const family = familyOf('mainboard-abc');

    expect(family?.expiry).toEqual({ kind: 'grace', ttlDays: 7 });
    expect(family?.entityOf('mainboard-abc')).toEqual('abc');
  });

  it('matches a puzzle key as keyDate', () => {
    const family = familyOf('manamatrix-2026-10-28');

    expect(family?.expiry).toEqual({ kind: 'keyDate', ttlDays: 7 });
    expect(family?.entityOf('manamatrix-2026-10-28')).toEqual('2026-10-28');
  });

  it('matches a suffix family', () => {
    const family = familyOf('cube123-blogpost');

    expect(family?.expiry).toEqual('permanent');
    expect(family?.entityOf('cube123-blogpost')).toEqual('cube123');
  });

  it('matches an exact family', () => {
    const family = familyOf('draftPackCardsPerRow');

    expect(family?.expiry).toEqual('permanent');
    expect(family?.entityOf('draftPackCardsPerRow')).toBeNull();
  });

  it('builds a concrete key from an entity id', () => {
    expect(familyOf('cc:draft:abc')?.key('xyz')).toEqual('cc:draft:xyz');
    expect(familyOf('mainboard-abc')?.key('xyz')).toEqual('mainboard-xyz');
    expect(familyOf('cube123-blogpost')?.key('xyz')).toEqual('xyz-blogpost');
    expect(familyOf('draftPackCardsPerRow')?.key('xyz')).toEqual('draftPackCardsPerRow');
  });

  it('declares showDraftRatings as legacy', () => {
    const family = familyOf('showDraftRatings-abc');

    expect(family?.expiry).toEqual('legacy');
    expect(family?.entityOf('showDraftRatings-abc')).toEqual('abc');
  });

  it('returns undefined for a key no family claims', () => {
    const claimed = FOREIGN_KEYS.filter((key) => familyOf(key) !== undefined);

    expect(claimed).toEqual([]);
  });

  it('claims every key family the client writes', () => {
    const unclaimed = SAMPLE_KEYS.filter((key) => familyOf(key) === undefined);

    expect(unclaimed).toEqual([]);
  });

  it('claims each key with exactly one family', () => {
    const ambiguous = SAMPLE_KEYS.map((key) => ({
      key,
      ids: FAMILIES.filter((family) => family.match.test(key)).map((family) => family.id),
    })).filter((entry) => entry.ids.length !== 1);

    expect(ambiguous).toEqual([]);
  });

  it('does not let the dated puzzle families swallow the global puzzle preference', () => {
    expect(familyOf('synergyconnect-seen-help')?.id).toEqual('synergyconnect-seen-help');
    // The pages write `<prefix>none` when no puzzle loaded; it is not dated, so it is not claimed.
    expect(familyOf('synergyconnect-none')).toBeUndefined();
    expect(familyOf('manamatrix-none')).toBeUndefined();
    expect(familyOf('crossword-none')).toBeUndefined();
  });

  it('declares a unique, anchored pattern for every family', () => {
    const ids = FAMILIES.map((family) => family.id);

    expect(new Set(ids).size).toEqual(ids.length);
    for (const family of FAMILIES) {
      expect(family.match.source.startsWith('^')).toBe(true);
      expect(family.match.source.endsWith('$')).toBe(true);
      expect(family.match.global).toBe(false);
      expect(family.note.length).toBeGreaterThan(0);
    }
  });

  it('lists the five legacy draft families task 8 migrates', () => {
    expect(LEGACY_DRAFT_FAMILY_IDS).toEqual(['draftstate-', 'mainboard-', 'sideboard-', 'trashboard-', 'picks-']);

    for (const id of LEGACY_DRAFT_FAMILY_IDS) {
      const family = FAMILIES.find((candidate) => candidate.id === id);
      expect(family?.expiry).toEqual({ kind: 'grace', ttlDays: 7 });
    }
  });

  it('declares every permanent family ahead of every deleting one', () => {
    // `familyOf` returns the first match, so this ordering is what decides an ambiguity if a
    // pattern is ever widened by accident: towards keeping data rather than deleting it. A
    // reorder that interleaved the two would silently flip that direction.
    const deleting = FAMILIES.findIndex((family) => family.expiry !== 'permanent');
    const stragglers = FAMILIES.slice(deleting).filter((family) => family.expiry === 'permanent');

    expect(deleting).toBeGreaterThan(0);
    expect(stragglers.map((family) => family.id)).toEqual([]);
  });
});
