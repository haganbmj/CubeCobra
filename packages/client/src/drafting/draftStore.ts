import Draft from '@utils/datatypes/Draft';
import type { State } from '@utils/datatypes/DraftState';
import { getInitialState, setupPicks } from '@utils/draftutil';

import DraftLocation, { addCard, location, locations, removeCard } from 'drafting/DraftLocation';

/**
 * Everything a draft in progress needs to survive a reload, in one record.
 *
 * These five values used to be five independent `localStorage` keys behind five
 * `useLocalStorage` atoms. Splitting them meant a single user action could update one and
 * leave the others describing an earlier moment — most visibly `state.seats[0].picks`
 * drifting from the separately stored pick order. One record and one reducer makes the
 * halves of an update indivisible.
 */
export interface DraftStore {
  state: State;
  mainboard: number[][][];
  sideboard: number[][][];
  trashboard: number[];
  picks: number[];
}

export type DraftAction =
  | { type: 'replaceState'; state: State }
  | {
      type: 'pickToBoard';
      board: 'deck' | 'sideboard';
      entries: { cardIndex: number; row: number; col: number }[];
      pick?: number;
    }
  | { type: 'recordPick'; cardIndex: number }
  | { type: 'trashPick'; cardIndex: number }
  | { type: 'moveCard'; source: DraftLocation; target: DraftLocation };

type BoardKey = 'mainboard' | 'sideboard';

// Mirrors the old `getLocationReferences`: the deck is the mainboard, anything else a
// drag can land on is the sideboard.
const boardKeyFor = (type: location): BoardKey => (type === locations.deck ? 'mainboard' : 'sideboard');

export const draftStoreKey = (draftId: string): string => `cc:draft:${draftId}`;

export const initialDraftStore = (draft: Draft): DraftStore => ({
  state: getInitialState(draft),
  mainboard: setupPicks(2, 8),
  sideboard: setupPicks(1, 8),
  trashboard: [],
  picks: [],
});

const readLegacyKey = <T>(key: string): T | undefined => {
  let raw: string | null;

  try {
    // `useLocalStorage` guarded its reads the same way, and for the same reasons the record
    // layer does: there is no window under SSR, and a browser that denies storage throws
    // from the accessor itself, before `getItem` can be called.
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return undefined;
    }
    raw = window.localStorage.getItem(key);
  } catch {
    // An unreachable store is an expected browser configuration, not an anomaly worth logging.
    return undefined;
  }

  if (raw === null) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`Failed to parse legacy draft key ${key}`, error);
    return undefined;
  }
};

/**
 * Rebuild a store from the five pre-record `localStorage` keys. These are flat JSON values
 * rather than records, so they are read directly rather than through the record layer.
 *
 * Taking an id rather than a `Draft` is what lets a caller holding nothing but a key
 * migrate. The price is that `state` has no fallback — `getInitialState` needs the draft —
 * so a missing or corrupt `draftstate-` key means there is nothing resumable here, whatever
 * the other four hold. Those four do have draft-free defaults, the same ones
 * `initialDraftStore` uses.
 */
export const draftStoreFromLegacyKeys = (draftId: string): DraftStore | null => {
  const state = readLegacyKey<State>(`draftstate-${draftId}`);

  if (state === undefined || state === null) {
    return null;
  }

  return {
    state,
    mainboard: readLegacyKey<number[][][]>(`mainboard-${draftId}`) ?? setupPicks(2, 8),
    sideboard: readLegacyKey<number[][][]>(`sideboard-${draftId}`) ?? setupPicks(1, 8),
    trashboard: readLegacyKey<number[]>(`trashboard-${draftId}`) ?? [],
    picks: readLegacyKey<number[]>(`picks-${draftId}`) ?? [],
  };
};

export const draftReducer = (store: DraftStore, action: DraftAction): DraftStore => {
  switch (action.type) {
    case 'replaceState': {
      // The incoming state is produced from a closure that may be a render behind, so its
      // first seat's pick order and trash pile are not trustworthy. The reducer's own
      // `picks` and `trashboard` are, and they are what gets POSTed on finish.
      const seats = action.state.seats.map((seat, index) =>
        index === 0 ? { ...seat, picks: store.picks, trashed: store.trashboard } : seat,
      );

      return { ...store, state: { ...action.state, seats } };
    }
    case 'pickToBoard': {
      const key = boardKeyFor(action.board);
      const board = store[key].map((row) => row.map((col) => [...col]));

      for (const entry of action.entries) {
        board[entry.row]![entry.col]!.push(entry.cardIndex);
      }

      return {
        ...store,
        [key]: board,
        // A pick made while predictions are still in flight has no card to record yet; the
        // pending-pick handler records it once they land.
        picks: action.pick === undefined ? store.picks : [action.pick, ...store.picks],
      };
    }
    case 'recordPick': {
      return { ...store, picks: [action.cardIndex, ...store.picks] };
    }
    case 'trashPick': {
      return { ...store, trashboard: [action.cardIndex, ...store.trashboard] };
    }
    case 'moveCard': {
      const { source, target } = action;

      if (source.equals(target)) {
        return store;
      }

      const sourceKey = boardKeyFor(source.type);
      const targetKey = boardKeyFor(target.type);
      const [card, remaining] = removeCard(store[sourceKey], source);

      // Both boards are settled in this one reduction. Resolving a setter per board and
      // calling them in sequence, each with a value derived from the same snapshot, is what
      // made the second write discard the first.
      const boards = { mainboard: store.mainboard, sideboard: store.sideboard };
      boards[sourceKey] = remaining;
      boards[targetKey] = addCard(sourceKey === targetKey ? remaining : boards[targetKey], target, card);

      return { ...store, ...boards };
    }
  }
};
