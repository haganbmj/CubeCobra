import Draft from '@utils/datatypes/Draft';
import type { State } from '@utils/datatypes/DraftState';
import { getInitialState, setupPicks } from '@utils/draftutil';

import DraftLocation from 'drafting/DraftLocation';
import {
  draftReducer,
  draftStoreFromLegacyKeys,
  draftStoreKey,
  DraftStore,
  initialDraftStore,
} from 'drafting/draftStore';

const buildDraft = (): Draft =>
  ({
    id: 'abc',
    cards: [],
    seats: [
      { bot: false, name: 'Player' },
      { bot: true, name: 'Bot 1' },
    ],
    InitialState: [
      [{ cards: [0, 1, 2], steps: [{ action: 'pick', amount: 1 }] }],
      [{ cards: [3, 4, 5], steps: [{ action: 'pick', amount: 1 }] }],
    ],
  }) as unknown as Draft;

const buildState = (overrides: Partial<State> = {}): State => ({
  seats: [
    { picks: [], trashed: [], pack: [10, 11] },
    { picks: [], trashed: [], pack: [12, 13] },
  ],
  stepQueue: [{ action: 'pick', amount: 1 }],
  pack: 1,
  pick: 1,
  ...overrides,
});

const buildStore = (overrides: Partial<DraftStore> = {}): DraftStore => ({
  state: buildState(),
  mainboard: setupPicks(2, 8),
  sideboard: setupPicks(1, 8),
  trashboard: [],
  picks: [],
  ...overrides,
});

describe('draftStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keys a draft record by its id', () => {
    expect(draftStoreKey('abc')).toEqual('cc:draft:abc');
  });

  it('builds an initial store from a draft', () => {
    const draft = buildDraft();

    const store = initialDraftStore(draft);

    expect(store.state).toEqual(getInitialState(draft));
    expect(store.mainboard).toEqual(setupPicks(2, 8));
    expect(store.sideboard).toEqual(setupPicks(1, 8));
    expect(store.trashboard).toEqual([]);
    expect(store.picks).toEqual([]);
  });

  it('adds entries to the named board and records the pick', () => {
    const store = buildStore();

    const next = draftReducer(store, {
      type: 'pickToBoard',
      board: 'deck',
      entries: [
        { cardIndex: 7, row: 0, col: 2 },
        { cardIndex: 8, row: 1, col: 3 },
      ],
      pick: 7,
    });

    expect(next.mainboard[0]![2]).toEqual([7]);
    expect(next.mainboard[1]![3]).toEqual([8]);
    expect(next.picks).toEqual([7]);
    expect(next.sideboard).toEqual(store.sideboard);
    expect(store.mainboard[0]![2]).toEqual([]);
  });

  it('adds to the sideboard when the board is sideboard', () => {
    const store = buildStore();

    const next = draftReducer(store, {
      type: 'pickToBoard',
      board: 'sideboard',
      entries: [{ cardIndex: 7, row: 0, col: 4 }],
      pick: 7,
    });

    expect(next.sideboard[0]![4]).toEqual([7]);
    expect(next.picks).toEqual([7]);
    expect(next.mainboard).toEqual(store.mainboard);
  });

  it('omits the pick when none is given', () => {
    const store = buildStore({ picks: [3] });

    const next = draftReducer(store, {
      type: 'pickToBoard',
      board: 'deck',
      entries: [{ cardIndex: 7, row: 0, col: 2 }],
    });

    expect(next.mainboard[0]![2]).toEqual([7]);
    expect(next.picks).toEqual([3]);
  });

  it('prepends a recorded pick', () => {
    const store = buildStore({ picks: [2, 1] });

    const next = draftReducer(store, { type: 'recordPick', cardIndex: 3 });

    expect(next.picks).toEqual([3, 2, 1]);
    expect(store.picks).toEqual([2, 1]);
  });

  it('prepends a trashed card', () => {
    const store = buildStore({ trashboard: [2, 1] });

    const next = draftReducer(store, { type: 'trashPick', cardIndex: 3 });

    expect(next.trashboard).toEqual([3, 2, 1]);
    expect(store.trashboard).toEqual([2, 1]);
  });

  it('moves a card within one board', () => {
    const mainboard = setupPicks(2, 8);
    mainboard[0]![1] = [5];
    const store = buildStore({ mainboard });

    const next = draftReducer(store, {
      type: 'moveCard',
      source: DraftLocation.deck(0, 1, 0),
      target: DraftLocation.deck(1, 4, 0),
    });

    expect(next.mainboard[0]![1]).toEqual([]);
    expect(next.mainboard[1]![4]).toEqual([5]);
    expect(next.sideboard).toEqual(store.sideboard);
  });

  it('moves a card from the mainboard to the sideboard', () => {
    const mainboard = setupPicks(2, 8);
    mainboard[0]![1] = [5];
    const store = buildStore({ mainboard });

    const next = draftReducer(store, {
      type: 'moveCard',
      source: DraftLocation.deck(0, 1, 0),
      target: DraftLocation.sideboard(0, 3, 0),
    });

    // Both boards have to be right after a single reduction. Two sequential setters built
    // from one snapshot would leave one of these two assertions holding the pre-move board.
    expect(next.mainboard[0]![1]).toEqual([]);
    expect(next.sideboard[0]![3]).toEqual([5]);
  });

  it('normalizes seats[0].picks and seats[0].trashed on replaceState', () => {
    const store = buildStore({ picks: [3, 2, 1], trashboard: [9] });
    // What `makePick` hands over is built from a closure that can be a render behind the
    // reducer: here the payload claims the player has picked and trashed nothing.
    const stale = buildState({
      seats: [
        { picks: [], trashed: [], pack: [10] },
        { picks: [4], trashed: [], pack: [12] },
      ],
      pick: 2,
    });

    const next = draftReducer(store, { type: 'replaceState', state: stale });

    expect(next.state.seats[0]!.picks).toEqual([3, 2, 1]);
    expect(next.state.seats[0]!.trashed).toEqual([9]);
    // Everything else on the payload is taken as given.
    expect(next.state.seats[0]!.pack).toEqual([10]);
    expect(next.state.seats[1]).toEqual({ picks: [4], trashed: [], pack: [12] });
    expect(next.state.pick).toEqual(2);
  });

  it('returns the same store reference for an action that changes nothing', () => {
    const mainboard = setupPicks(2, 8);
    mainboard[0]![1] = [5];
    const store = buildStore({ mainboard });

    const next = draftReducer(store, {
      type: 'moveCard',
      source: DraftLocation.deck(0, 1, 0),
      target: DraftLocation.deck(0, 1, 0),
    });

    expect(next).toBe(store);
  });

  it('builds a store from legacy keys', () => {
    const state = buildState({ pick: 4 });
    const mainboard = setupPicks(2, 8);
    mainboard[0]![1] = [5];
    const sideboard = setupPicks(1, 8);
    sideboard[0]![2] = [6];
    localStorage.setItem('draftstate-abc', JSON.stringify(state));
    localStorage.setItem('mainboard-abc', JSON.stringify(mainboard));
    localStorage.setItem('sideboard-abc', JSON.stringify(sideboard));
    localStorage.setItem('trashboard-abc', JSON.stringify([9]));
    localStorage.setItem('picks-abc', JSON.stringify([3, 2, 1]));

    expect(draftStoreFromLegacyKeys('abc')).toEqual({
      state,
      mainboard,
      sideboard,
      trashboard: [9],
      picks: [3, 2, 1],
    });
  });

  it('fills defaults for legacy keys that are missing', () => {
    const state = buildState();
    localStorage.setItem('draftstate-abc', JSON.stringify(state));
    localStorage.setItem('picks-abc', JSON.stringify([3]));

    expect(draftStoreFromLegacyKeys('abc')).toEqual({
      state,
      mainboard: setupPicks(2, 8),
      sideboard: setupPicks(1, 8),
      trashboard: [],
      picks: [3],
    });
  });

  it('returns null when there is no legacy draft state for the draft', () => {
    localStorage.setItem('mainboard-abc', JSON.stringify(setupPicks(2, 8)));
    localStorage.setItem('sideboard-abc', JSON.stringify(setupPicks(1, 8)));
    localStorage.setItem('trashboard-abc', JSON.stringify([9]));
    localStorage.setItem('picks-abc', JSON.stringify([3, 2, 1]));

    expect(draftStoreFromLegacyKeys('abc')).toBeNull();
  });

  it('returns null when draftstate is unparseable', () => {
    // The parse failure is logged, which would otherwise print to the test output.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('draftstate-abc', 'not json');

    expect(draftStoreFromLegacyKeys('abc')).toBeNull();
    expect(consoleError).toHaveBeenCalled();
  });

  it('returns null when localStorage itself cannot be reached', () => {
    // Browsers that deny storage — third-party cookies blocked, a sandboxed iframe —
    // throw a SecurityError from the accessor, before any method can be called.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('storage is denied', 'SecurityError');
      },
    });

    try {
      expect(() => draftStoreFromLegacyKeys('abc')).not.toThrow();
      expect(draftStoreFromLegacyKeys('abc')).toBeNull();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      if (descriptor) {
        Object.defineProperty(window, 'localStorage', descriptor);
      }
    }
  });
});
