/**
 * Characterization tests for `pages/CubeDraftPage`.
 *
 * These describe the page as it behaves **today**, before the draft-storage refactor. They are
 * the gate for that refactor: a failure here means behavior changed, not that the page is wrong.
 * Anything that looks like a bug is recorded as-is rather than corrected.
 *
 * The document URL matches the page's post-finish redirect target so that assignment is a
 * same-URL no-op instead of a jsdom "Not implemented: navigation" error.
 *
 * @jest-environment-options {"url": "http://localhost/draft/deckbuilder/draft-under-test"}
 */
import DraftLocation from 'drafting/DraftLocation';

import { cardName, renderDraftPage, resetDraftPageEnvironment, SEAT_COUNT, storageKeys } from './draftPageHarness';

const flatten = (board: number[][][] | null): number[] => (board ?? []).flat(2);

describe('CubeDraftPage characterization', () => {
  beforeEach(() => {
    resetDraftPageEnvironment();
  });

  it('derives state from the draft and writes nothing to storage until the first pick', async () => {
    const harness = await renderDraftPage();

    // `useLocalStorage` persists on write, not on read, so nothing is stored until the first pick.
    expect(Object.values(storageKeys).map((key) => window.localStorage.getItem(key))).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);

    // The in-memory state is still derived from the draft: seat 0 is looking at its first pack.
    expect(harness.getPackCards()).toEqual([cardName(0), cardName(1), cardName(2)]);
    expect(harness.getPackTitle()).toBe('Pack 1 Pick 1: Pick 1 card');
    // ...and the opening bot-prediction request describes every seat's first pack.
    expect(harness.predictRequests()).toHaveLength(1);
    expect(harness.predictRequests()[0]!.inputs).toHaveLength(SEAT_COUNT);
    expect(harness.predictRequests()[0]!.inputs[0]).toEqual({
      pack: ['oracle-0', 'oracle-1', 'oracle-2'],
      picks: [],
    });

    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));

    const stored = harness.getStoredDraft();
    expect(stored).not.toBeNull();
    expect(stored!.seats).toHaveLength(SEAT_COUNT);
    expect(stored!.pack).toBe(1);
    // Two packs of pick/pass/pick/pass/trash, each closed with the implicit `endpack`, minus the
    // pick and pass just consumed.
    expect(stored!.stepQueue.map((step) => step.action)).toEqual([
      'pick',
      'pass',
      'trash',
      'endpack',
      'pick',
      'pass',
      'pick',
      'pass',
      'trash',
      'endpack',
    ]);
  });

  it('moves a clicked pack card to the mainboard and records the pick', async () => {
    const harness = await renderDraftPage();

    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));

    expect(harness.getMainboard()).toEqual([cardName(0)]);
    expect(harness.getPicks()).toEqual([0]);
    expect(flatten(harness.getStored(storageKeys.mainboard))).toEqual([0]);
    expect(harness.getStored(storageKeys.picks)).toEqual([0]);
    // The pack it came from no longer offers it.
    expect(harness.getPackCards()).not.toContain(cardName(0));
  });

  it('advances the pack title after a pick', async () => {
    const harness = await renderDraftPage();

    expect(harness.getPackTitle()).toBe('Pack 1 Pick 1: Pick 1 card');

    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));

    expect(harness.getPackTitle()).toBe('Pack 1 Pick 2: Pick 1 card');
  });

  it('moves a trashed card to the trashboard, not the mainboard', async () => {
    const harness = await renderDraftPage();

    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));
    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));

    // The pack's third step is a trash.
    expect(harness.getPackTitle()).toBe('Pack 1 Pick 3: Trash 1 card');
    const mainboardBefore = harness.getMainboard();
    const trashed = harness.getPackCards()[0]!;

    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));

    expect(harness.getTrashboard()).toEqual([trashed]);
    expect(harness.getMainboard()).toEqual(mainboardBefore);
    expect(harness.getMainboard()).not.toContain(trashed);
    expect(harness.getSideboard()).toEqual([]);
    // A trash is not a pick.
    expect(harness.getPicks()).toHaveLength(2);
  });

  it('moves a card from the mainboard to the sideboard', async () => {
    const harness = await renderDraftPage();

    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));
    const [picked] = harness.getMainboardPositions();
    expect(picked).toBeDefined();

    await harness.dragEnd(
      DraftLocation.deck(picked!.row, picked!.col, picked!.index),
      DraftLocation.sideboard(0, 0, 0),
    );

    expect(harness.getMainboard()).toEqual([]);
    expect(harness.getSideboard()).toEqual([cardName(0)]);
    // Two independent setters, two independent writes — both keys must land.
    expect(flatten(harness.getStored(storageKeys.mainboard))).toEqual([]);
    expect(flatten(harness.getStored(storageKeys.sideboard))).toEqual([0]);
    // Moving between boards does not rewrite the pick order.
    expect(harness.getPicks()).toEqual([0]);
  });

  it('moves a card within the mainboard without losing it', async () => {
    const harness = await renderDraftPage();

    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));
    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));

    const before = harness.getMainboardPositions();
    expect(before).toHaveLength(2);
    const moved = before[0]!;
    expect(moved.col).not.toBe(7);

    await harness.dragEnd(DraftLocation.deck(moved.row, moved.col, moved.index), DraftLocation.deck(1, 7, 0));

    const after = harness.getMainboardPositions();
    expect(after).toHaveLength(2);
    expect(after.map((entry) => entry.name).sort()).toEqual(before.map((entry) => entry.name).sort());
    expect(after.find((entry) => entry.name === moved.name)).toEqual({
      name: moved.name,
      row: 1,
      col: 7,
      index: 0,
    });
    expect(flatten(harness.getStored(storageKeys.mainboard)).sort()).toEqual(
      before.map((entry) => Number(entry.name.replace('Card ', ''))).sort(),
    );
  });

  it('queues a pick made while predictions are in flight', async () => {
    const harness = await renderDraftPage({ holdPredictions: true });

    expect(harness.pendingPredictionCount()).toBe(1);

    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));

    // The board updates optimistically...
    expect(harness.getMainboard()).toEqual([cardName(0)]);
    // ...but the pick is not recorded yet, and the pack is replaced by the waiting state.
    expect(harness.getPicks()).toEqual([]);
    expect(harness.isPackRendered()).toBe(false);

    await harness.resolvePredictions();

    expect(harness.getPicks()).toEqual([0]);
    expect(harness.getMainboard()).toEqual([cardName(0)]);
  });

  it('posts the accumulated state when the draft is finished', async () => {
    const harness = await renderDraftPage();

    const request = await harness.finishDraft();

    expect(harness.finishRequests()).toHaveLength(1);
    expect(request.url).toBe('/draft/finish/draft-under-test');

    const mainboard = flatten(request.body.mainboard);
    const trashed = request.body.state.seats[0]!.trashed;
    const picks = request.body.state.seats[0]!.picks;

    const picked = harness.playLog().filter((entry) => entry.action === 'pick');
    const binned = harness.playLog().filter((entry) => entry.action === 'trash');

    // Two packs of pick/pick/trash: four cards kept, two binned.
    expect(picked).toHaveLength(4);
    expect(binned).toHaveLength(2);
    expect(flatten(request.body.sideboard)).toEqual([]);
    // The mainboard holds exactly the picked cards (ordered by deck cell, not by pick).
    expect([...mainboard].sort((a, b) => a - b)).toEqual(picked.map((entry) => entry.index).sort((a, b) => a - b));
    // `picks` and `trashed` are unshifted, so both come back most-recent-first.
    expect(picks).toEqual(picked.map((entry) => entry.index).reverse());
    expect(trashed).toEqual(binned.map((entry) => entry.index).reverse());

    expect(request.body.state.seats).toHaveLength(SEAT_COUNT);
    // The posted boards match what is still in storage.
    expect(flatten(harness.getStored(storageKeys.mainboard))).toEqual(mainboard);
    expect(harness.getStored(storageKeys.picks)).toEqual(picks);
    expect(harness.getTrashboard()).toEqual(binned.map((entry) => entry.name).reverse());
  });
});
