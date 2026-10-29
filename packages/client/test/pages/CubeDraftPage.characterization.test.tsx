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

import {
  cardName,
  DRAFT_ID,
  DRAFT_RECORD_KEY,
  DraftPageHarness,
  renderDraftPage,
  resetDraftPageEnvironment,
  SEAT_COUNT,
  storageKeys,
} from './draftPageHarness';

const flatten = (board: number[][][] | null | undefined): number[] => (board ?? []).flat(2);

/**
 * Drains the held prediction queue. Resolving the request a pick is waiting on lets that pick
 * commit its new state, which in turn fires a fresh ratings fetch — so a single resolve is not
 * enough to get back to an idle pack. Loop until nothing is outstanding.
 */
const settlePredictions = async (harness: DraftPageHarness): Promise<void> => {
  for (let attempt = 0; attempt < 8 && harness.pendingPredictionCount() > 0; attempt += 1) {
    await harness.resolvePredictions();
  }
};

describe('CubeDraftPage characterization', () => {
  beforeEach(() => {
    resetDraftPageEnvironment();
  });

  it('derives state from the draft and writes nothing to storage until the first pick', async () => {
    const harness = await renderDraftPage();

    // The reducer persists on change, not on read, so nothing is stored until the first pick.
    expect(window.localStorage.getItem(DRAFT_RECORD_KEY)).toBeNull();
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
    expect(flatten(harness.getStoredStore()?.mainboard)).toEqual([0]);
    expect(harness.getStoredStore()?.picks).toEqual([0]);
    // The pack it came from no longer offers it.
    expect(harness.getPackCards()).not.toContain(cardName(0));
  });

  it('stores the whole draft in one record', async () => {
    const harness = await renderDraftPage();

    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));

    const stored = harness.getStoredStore();
    expect(stored).not.toBeNull();
    expect(Object.keys(stored!).sort()).toEqual(['mainboard', 'picks', 'sideboard', 'state', 'trashboard']);
    expect(stored!.state.seats).toHaveLength(SEAT_COUNT);
    expect(flatten(stored!.mainboard)).toEqual([0]);
    expect(flatten(stored!.sideboard)).toEqual([]);
    expect(stored!.trashboard).toEqual([]);
    expect(stored!.picks).toEqual([0]);

    // None of the five keys that used to back those values is written any more, and the record
    // is the only thing this session stored about the draft under test. Scoped to this draft's
    // keys rather than the whole store, so an unrelated provider writing to localStorage inside
    // the harness cannot break an assertion that is about the draft record.
    expect(Object.values(storageKeys).map((key) => window.localStorage.getItem(key))).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    const storedKeys = Array.from({ length: window.localStorage.length }, (_unused, index) =>
      window.localStorage.key(index),
    );
    expect(storedKeys.filter((key) => key !== null && key.includes(DRAFT_ID))).toEqual([DRAFT_RECORD_KEY]);
  });

  it('drops a dragged pack card into the cell it was dropped on', async () => {
    const harness = await renderDraftPage();

    // Card 0 is a one-drop creature, so its default placement is row 0, column 1 — the drag
    // target below is deliberately somewhere else.
    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.deck(1, 7, 0));

    expect(harness.getMainboardPositions()).toEqual([{ name: cardName(0), row: 1, col: 7, index: 0 }]);
    expect(harness.getPicks()).toEqual([0]);
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
    // One record, one write — both boards must land together.
    expect(flatten(harness.getStoredStore()?.mainboard)).toEqual([]);
    expect(flatten(harness.getStoredStore()?.sideboard)).toEqual([0]);
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
    expect(flatten(harness.getStoredStore()?.mainboard).sort()).toEqual(
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

  it('never persists a half-advanced draft state while a pick is in flight', async () => {
    const harness = await renderDraftPage({ holdPredictions: true });

    // Queue a pick behind the opening prediction. That writes the record for the first time,
    // still carrying the untouched opening state.
    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));

    const before = harness.getStoredStore();
    expect(before).not.toBeNull();
    expect(before!.state.pack).toBe(1);
    expect(before!.state.pick).toBe(1);
    expect(before!.state.stepQueue[0]!.action).toBe('pick');

    // Resolving the opening prediction releases the queued pick, which runs `makePick`. That
    // advances a working copy of the state and then waits on a fresh prediction before
    // publishing it, so the draft is now mid-flight.
    await harness.resolvePredictions();
    expect(harness.pendingPredictionCount()).toBe(1);

    const inFlight = harness.getStoredStore();
    expect(inFlight).not.toBeNull();
    // Nothing published yet, so storage must still describe the pre-pick draft rather than a
    // state whose packs and step queue have moved on while its counters have not. A reload
    // here has to resume a draft that can still be finished.
    expect(inFlight!.state.stepQueue.map((step) => step.action)).toEqual(
      before!.state.stepQueue.map((step) => step.action),
    );
    expect(inFlight!.state.seats.map((seat) => seat.pack)).toEqual(before!.state.seats.map((seat) => seat.pack));
    expect(inFlight!.state).toEqual(before!.state);

    // And once it does publish, the published state is internally consistent.
    await settlePredictions(harness);
    const published = harness.getStoredStore();
    expect(published!.state.pick).toBe(2);
    expect(published!.state.stepQueue[0]!.action).toBe('pick');
  });

  it('does not record a pick when a trash is queued behind predictions', async () => {
    const harness = await renderDraftPage({ holdPredictions: true });

    // Walk to the pack's trash step, letting each round's predictions land so the picks on the
    // way there are recorded the ordinary way.
    await settlePredictions(harness);
    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));
    await settlePredictions(harness);
    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));
    // Resolve only the request that second pick is waiting on. Committing its state opens the
    // trash step and fires a fresh ratings fetch, which stays in flight.
    await harness.resolvePredictions();

    expect(harness.getPackTitle()).toBe('Pack 1 Pick 3: Trash 1 card');
    const picksBeforeTrash = harness.getPicks();
    expect(picksBeforeTrash).toHaveLength(2);

    // So the trash click below lands while predictions are loading and has to be queued.
    expect(harness.pendingPredictionCount()).toBe(1);
    const trashed = harness.getPackCards()[0]!;

    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));
    await settlePredictions(harness);

    expect(harness.getTrashboard()).toEqual([trashed]);
    // A queued trash is still a trash: it must not be recorded as a pick.
    expect(harness.getPicks()).toEqual(picksBeforeTrash);
    expect(harness.getMainboard()).not.toContain(trashed);
    expect(harness.getSideboard()).toEqual([]);
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
    // Storage is no longer a post-hoc cross-check for the POST body: submitting the draft
    // clears the record (see 'clears the draft record once the draft is submitted'), so by
    // the time the request is observable the local copy is already gone. The boards, picks
    // and trashed lists it used to be compared against are all asserted on the body above.
    expect(harness.getStoredStore()).toBeNull();
  });

  it('clears the draft record once the draft is submitted', async () => {
    const harness = await renderDraftPage();

    await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));
    // The record has to exist first, or "it is gone afterwards" proves nothing.
    expect(window.localStorage.getItem(DRAFT_RECORD_KEY)).not.toBeNull();

    await harness.finishDraft();
    await harness.flush();

    // The server owns the draft now, so the local copy is dead weight.
    expect(window.localStorage.getItem(DRAFT_RECORD_KEY)).toBeNull();
    expect(harness.getStoredStore()).toBeNull();
  });

  it('keeps the draft record when finishing fails', async () => {
    // The page logs the failure it is being asked to produce; keep the suite output clean.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const harness = await renderDraftPage({ failFinish: true });

      await harness.finishDraft();
      await harness.flush();

      const picked = harness.playLog().filter((entry) => entry.action === 'pick');

      // The POST never landed, so the draft has to stay resumable — clearing it here would
      // destroy a draft the server knows nothing about.
      const stored = harness.getStoredStore();
      expect(stored).not.toBeNull();
      expect(stored?.picks).toEqual(picked.map((entry) => entry.index).reverse());
      expect(flatten(stored?.mainboard)).toHaveLength(picked.length);
    } finally {
      consoleError.mockRestore();
    }
  });
});
