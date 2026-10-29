import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { DndContext } from '@dnd-kit/core';
import { isVoucher, makeSubtitle } from '@utils/cardutil';
import Cube from '@utils/datatypes/Cube';
import Draft from '@utils/datatypes/Draft';
import { getCardDefaultRowColumn } from '@utils/draftutil';

import { Card, CardBody, CardHeader } from 'components/base/Card';
import Container from 'components/base/Container';
import Spinner from 'components/base/Spinner';
import Text from 'components/base/Text';
import DeckStacks from 'components/DeckStacks';
import P1P1FromPackGenerator from 'components/p1p1/P1P1FromPackGenerator';
import Pack from 'components/Pack';
import RenderToRoot from 'components/RenderToRoot';
import { CSRFContext } from 'contexts/CSRFContext';
import DraftLocation, { location } from 'drafting/DraftLocation';
import { locations } from 'drafting/DraftLocation';
import {
  clearLegacyDraftKeys,
  draftReducer,
  draftStoreFromLegacyKeys,
  draftStoreKey,
  initialDraftStore,
} from 'drafting/draftStore';
import useAlerts, { Alerts } from 'hooks/UseAlerts';
import { useStoredReducer } from 'hooks/useStoredReducer';
import CubeLayout from 'layouts/CubeLayout';
import MainLayout from 'layouts/MainLayout';
import { trackEvent } from 'utils/analytics';
import { removeRecord } from 'utils/localStorage/record';

interface CubeDraftPageProps {
  cube: Cube;
  draft: Draft;
}

interface PredictResponse {
  prediction: {
    oracle: string;
    rating: number;
  }[][];
}

interface DraftStatus {
  loading: boolean;
  predictionsLoading: boolean;
  predictError: boolean;
  retryInProgress: boolean;
  draftCompleted: boolean;
}

interface BatchPredictRequest {
  pack: string[];
  picks: string[];
}

/**
 * A selection the user made while bot predictions were still loading. The action has to travel
 * with the index: once the predictions land, a `pick` is recorded in the pick order and a
 * `trash` is not.
 */
interface PendingPick {
  packIndex: number;
  action: 'pick' | 'trash';
}

const fetchBatchPredict = async (inputs: BatchPredictRequest[]): Promise<PredictResponse> => {
  //Unlike csrfFetch which has a default client time, a fetch like this doesn't.
  const response = await fetch('/api/draftbots/batchpredict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch batch predictions: ${response.status}`);
  }

  return response.json();
};

const processPredictions = (json: PredictResponse, packCards: any[]): number[] => {
  // Create a map of oracle IDs to ratings
  const predictionsMap = new Map(json.prediction[0].map((p) => [p.oracle, p.rating]));
  // Then add ratings to packCards while maintaining pack order
  // For vouchers, sum the ratings of their unique sub-cards (picking a voucher gives you ALL sub-cards)
  const rawRatings = packCards.map((card): number => {
    if (card.voucherOracleIds && card.voucherOracleIds.length > 0) {
      // Use Set to deduplicate oracle_ids - ML returns one rating per unique oracle
      const uniqueOracleIds = [...new Set<string>(card.voucherOracleIds as string[])];
      return uniqueOracleIds.reduce((acc: number, oracleId: string) => acc + (predictionsMap.get(oracleId) || 0), 0);
    }
    return predictionsMap.get(card.oracle_id) || 0;
  });

  // Normalize: duplicates get the same rating, then normalize so total = 100%
  const total = rawRatings.reduce((acc, r) => acc + r, 0);
  return total > 0 ? rawRatings.map((r) => r / total) : rawRatings;
};

const CubeDraftPage: React.FC<CubeDraftPageProps> = ({ cube, draft }) => {
  /**
   * Expand a picked card index into board entries. For normal cards, returns [{ cardIndex, row, col }].
   * For vouchers, returns entries for each of the voucher's sub-cards (using pre-expanded indices).
   * The voucher itself is NOT added to the player's board.
   */
  const expandPickForBoard = useCallback(
    (cardIndex: number): { cardIndex: number; row: number; col: number }[] => {
      const card = draft.cards[cardIndex];
      // getCardDefaultRowColumn dereferences the card, so never pass it a missing one.
      if (!card) return [{ cardIndex, row: 1, col: 0 }];

      if (isVoucher(card) && card.voucher_card_indices && card.voucher_card_indices.length > 0) {
        // Use pre-expanded sub-card indices from draft creation
        return card.voucher_card_indices
          .filter((subCardIndex) => draft.cards[subCardIndex])
          .map((subCardIndex) => ({
            cardIndex: subCardIndex,
            ...getCardDefaultRowColumn(draft.cards[subCardIndex]),
          }));
      }

      return [{ cardIndex, ...getCardDefaultRowColumn(card) }];
    },
    [draft.cards],
  );

  // Draft State
  // These reflect the current state of the draft objects, including the cards in the pack, the picks made, and the ratings for each card.
  // One record, one reducer: every half of an update lands together, so the pick order can no
  // longer drift from the boards it describes.
  const [store, dispatch] = useStoredReducer(
    draftStoreKey(draft.id),
    draftReducer,
    () => draftStoreFromLegacyKeys(draft.id) ?? initialDraftStore(draft),
  );
  const { state, mainboard, sideboard, trashboard, picks } = store;
  const [ratings, setRatings] = useState<number[]>([]);
  const [showRatings, setShowRatings] = useState(false);
  const [currentPredictions, setCurrentPredictions] = useState<PredictResponse | null>(null);
  const [pendingPick, setPendingPick] = useState<PendingPick | null>(null); // Add state to track the pending pick made during predictionsLoading

  const { alerts, addAlert } = useAlerts();

  // Draft Status
  // These are used to track the status of the draft itself, including loading, errors, etc.
  const [draftStatus, setDraftStatus] = useState<DraftStatus>({
    loading: false, // We're not showing a pack because we're waiting for something
    predictionsLoading: false, // We're waiting for the bots to make a pick
    predictError: false, // Bot predict call failed
    retryInProgress: false, // User's attempting to handle that failure
    draftCompleted: false, // We've made the final pick and are ready to endDraft
  });

  const [dragStartTime, setDragStartTime] = useState<number | null>(null);
  const { csrfFetch } = useContext(CSRFContext);

  const getLocationReferences = useCallback(
    (type: location): any[][][] => {
      if (type === locations.deck) {
        return mainboard;
      } else {
        return sideboard;
      }
    },
    [mainboard, sideboard],
  );

  const endDraft = useCallback(async () => {
    setDraftStatus((prev) => ({ ...prev, loading: true }));

    // Built from the reducer's own `picks`/`trashboard` rather than from `state.seats[0]`:
    // a pick is recorded before `makePick` dispatches the state that follows it, so the seat
    // is a pick behind until that dispatch lands.
    const draftState = {
      ...state,
      seats: [{ ...state.seats[0], picks, trashed: trashboard }, ...state.seats.slice(1)],
    };

    try {
      // Bot (AI opponent) decks are now built asynchronously server-side by the
      // bot-deckbuild pipeline, so finishing is a single fast request — no blocking ML
      // loop. The deck view shows a "bot decks building" banner until they're ready.
      const finishResponse = await csrfFetch(`/draft/finish/${draft.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: draftState,
          mainboard,
          sideboard,
        }),
        timeout: 60 * 1000,
      });

      if (!finishResponse.ok) {
        throw new Error(`HTTP error! Status: ${finishResponse.status}`);
      }

      // The server owns this draft's state now, so the local copy is dead weight. Only once
      // the POST is confirmed: a draft whose submission failed is still the user's only copy.
      // The legacy keys go with it: the redirect below is the next page load, and the reaper
      // rebuilds a record for any legacy draft id that has none — which would resurrect this
      // draft's pre-submit state seconds after it was cleared.
      removeRecord(draftStoreKey(draft.id));
      clearLegacyDraftKeys(draft.id);

      // Funnel denominator: a finished draft. "Submitted without building" is
      // derived in GA as draft_complete minus deck_build (no save = no event).
      trackEvent('draft_complete', { type: 'draft' });
      window.location.href = `/draft/deckbuilder/${draft.id}`;
    } catch (err) {
      console.error('endDraft error caught:', err);
      addAlert(
        'danger',
        'Error finishing draft, please reach out to the Discord linking the cube, draft, and a screenshot',
      );
      setDraftStatus((prev) => ({ ...prev, loading: false, draftCompleted: false }));
    }
  }, [csrfFetch, draft.id, mainboard, picks, sideboard, state, setDraftStatus, trashboard, addAlert]);

  // Helper to get oracle_ids from a card, expanding vouchers to sub-card oracle_ids
  const getCardOracleIds = useCallback(
    (index: number): string[] => {
      const card = draft.cards[index];
      if (!card) return [];

      if (isVoucher(card)) {
        // Prefer voucher_card_indices (pre-expanded at draft creation), fallback to voucher_cards
        if (card.voucher_card_indices && card.voucher_card_indices.length > 0) {
          return card.voucher_card_indices
            .map((idx) => draft.cards[idx]?.details?.oracle_id)
            .filter((id): id is string => Boolean(id));
        }
        if (card.voucher_cards && card.voucher_cards.length > 0) {
          return card.voucher_cards.map((vc) => vc.details?.oracle_id).filter((id): id is string => Boolean(id));
        }
      }

      return card.details?.oracle_id ? [card.details.oracle_id] : [];
    },
    [draft.cards],
  );

  const getPredictions = useCallback(
    async (request: { state: any; packCards: { index: number; oracle_id: string; voucherOracleIds?: string[] }[] }) => {
      setDraftStatus((prev) => ({ ...prev, predictionsLoading: true, predictError: false }));
      try {
        const inputs = request.state.seats.map((seat: any) => ({
          pack: seat.pack.flatMap((index: number) => getCardOracleIds(index)),
          picks: seat.picks.flatMap((index: number) => getCardOracleIds(index)),
        }));

        const json = await fetchBatchPredict(inputs);
        setCurrentPredictions(json);
        setRatings(processPredictions(json, request.packCards));
        return json;
      } catch (error) {
        console.error('Error fetching predictions:', error, 'inputs', request.state);
        setDraftStatus((prev) => ({ ...prev, predictError: true }));
        return null;
      } finally {
        setDraftStatus((prev) => ({ ...prev, predictionsLoading: false }));
      }
    },
    [getCardOracleIds],
  );

  const handleRetryPredict = useCallback(async () => {
    if (draftStatus.retryInProgress || !state?.seats?.[0]?.pack) {
      return;
    }

    setDraftStatus((prev) => ({ ...prev, retryInProgress: true }));
    try {
      const currentState = state;
      const packCards = currentState.seats[0].pack.map((index) => {
        const card = draft.cards[index];
        const voucherOracleIds =
          isVoucher(card) && card?.voucher_cards
            ? card.voucher_cards.map((vc) => vc.details?.oracle_id).filter((id): id is string => Boolean(id))
            : undefined;
        return {
          index,
          oracle_id: card?.details?.oracle_id || '',
          voucherOracleIds,
        };
      });
      await getPredictions({ state: currentState, packCards });
    } finally {
      setDraftStatus((prev) => ({ ...prev, retryInProgress: false }));
    }
  }, [state, draft.cards, getPredictions, draftStatus.retryInProgress, setDraftStatus]);

  const makePick = useCallback(
    async (packIndex: number) => {
      setDraftStatus((prev) => ({ ...prev, loading: true }));
      setRatings([]); // Clear ratings
      // Every level this function mutates is copied first. It advances the state in place and
      // only publishes it at the end, after awaiting predictions — and the store now persists
      // on change, so a shallow copy would let those intermediate mutations reach
      // `localStorage` through the store's own objects. A reload inside that window would then
      // restore a half-advanced draft: step queue shifted and packs rotated, but `pack`/`pick`
      // still describing the pick that never finished. It also makes `replaceState` safe to
      // alias this payload, rather than safe only because nothing touches it afterwards.
      const newState = {
        ...state,
        stepQueue: [...state.stepQueue],
        seats: state.seats.map((seat) => ({
          ...seat,
          pack: [...seat.pack],
          picks: [...seat.picks],
          trashed: [...seat.trashed],
        })),
      };
      const currentStep = newState.stepQueue[0];

      if (!currentStep) {
        // The queue is empty — the draft finishing should already be in progress.
        setDraftStatus((prev) => ({ ...prev, loading: false }));
        return;
      }

      // The reducer owns the pick order: `replaceState` writes its own `picks`/`trashboard`
      // into seat 0, so nothing is copied in from a closure here.

      // if amount is more than 1
      if (currentStep.amount && currentStep.amount > 1) {
        // we will decrement the amount and make the pick
        newState.stepQueue[0] = { ...currentStep, amount: currentStep.amount - 1 };
      } else {
        // we need to pop the current step
        newState.stepQueue.shift();
      }

      if (currentStep.action === 'endpack' || currentStep.action === 'pass') {
        // This should never happen
        setDraftStatus((prev) => ({ ...prev, loading: false }));
        return;
      }

      if (currentStep.action === 'pick' || currentStep.action === 'trash') {
        // Use existing predictions for bot picks
        if (currentPredictions?.prediction) {
          const picks = currentPredictions.prediction.slice(1).map((seat, index) => {
            const pack = state.seats[index + 1].pack.map((i) => draft.cards[i].details?.oracle_id);

            if (pack.length === 0) {
              return -1;
            }

            if (seat.length === 0) {
              // pick at random
              return Math.floor(Math.random() * pack.length);
            }

            const oracle = seat.reduce((prev, current) => (prev.rating > current.rating ? prev : current)).oracle;
            const oracleIndex = pack.findIndex((oracleId) => oracleId === oracle);
            //For some reason could not map the predicted oracle id to a card in the pack, fallback to random assignment
            if (oracleIndex === -1) {
              console.log(`Best oracle id from predictions is ${oracle}, pack contains ${pack}`);
              // pick at random
              return Math.floor(Math.random() * pack.length);
            }

            return oracleIndex;
          });

          // make all the picks
          if (currentStep.action === 'pick') {
            newState.seats[0].picks.unshift(state.seats[0].pack[packIndex]);
          } else if (currentStep.action === 'trash') {
            newState.seats[0].trashed.unshift(state.seats[0].pack[packIndex]);
          }
          newState.seats[0].pack.splice(packIndex, 1);

          for (let i = 1; i < state.seats.length; i++) {
            const pick = picks[i - 1];

            if (currentStep.action === 'pick') {
              newState.seats[i].picks.unshift(state.seats[i].pack[pick]);
            } else if (currentStep.action === 'trash') {
              newState.seats[i].trashed.unshift(state.seats[i].pack[pick]);
            }
            newState.seats[i].pack.splice(pick, 1);
          }
        }
      } else if (currentStep.action === 'pickrandom' || currentStep.action === 'trashrandom') {
        // make random selection
        if (currentStep.action === 'pickrandom') {
          newState.seats[0].picks.unshift(state.seats[0].pack[packIndex]);
          for (let i = 1; i < state.seats.length; i++) {
            const randomIndex = Math.floor(Math.random() * state.seats[i].pack.length);
            newState.seats[i].picks.unshift(state.seats[i].pack[randomIndex]);
            newState.seats[i].pack.splice(randomIndex, 1);
          }
        } else if (currentStep.action === 'trashrandom') {
          newState.seats[0].trashed.unshift(state.seats[0].pack[packIndex]);

          for (let i = 1; i < state.seats.length; i++) {
            const randomIndex = Math.floor(Math.random() * state.seats[i].pack.length);
            newState.seats[i].trashed.unshift(randomIndex);
            newState.seats[i].pack.splice(randomIndex, 1);
          }
        }
        newState.seats[0].pack.splice(packIndex, 1);
      }

      // get the next step
      const nextStep = newState.stepQueue[0];

      // either pass the pack, open the next pack, or end the draft
      if (!nextStep) {
        // should never happen
        setDraftStatus((prev) => ({ ...prev, loading: false }));
        return;
      }

      if (nextStep.action === 'pass') {
        // pass left on an odd pick, right on an even pick
        const direction = state.pack % 2 === 0 ? 1 : -1;
        const packs = newState.seats.map((seat) => seat.pack);

        for (let i = 0; i < state.seats.length; i++) {
          const nextSeat = newState.seats[(i + direction + draft.seats.length) % state.seats.length];
          nextSeat.pack = packs[i];
        }

        newState.pick += 1;

        // pop the step
        newState.stepQueue.shift();
      }

      if (nextStep.action === 'endpack') {
        // we open the next pack or end the draft
        if (draft.InitialState && state.pack === draft.InitialState[0].length) {
          dispatch({ type: 'replaceState', state: newState });
          setDraftStatus((prev) => ({ ...prev, loading: false, draftCompleted: true }));
          return;
        }

        // open the next pack
        newState.pack += 1;
        newState.pick = 1;

        for (let i = 0; i < state.seats.length; i++) {
          newState.seats[i].pack = draft.InitialState ? draft.InitialState[i][newState.pack - 1].cards : [];
        }

        // pop the step
        newState.stepQueue.shift();

        // Clear ratings before opening new pack
        setRatings([]);
      }

      // After advancing the step queue (post-pick + post-pass, or post-endpack),
      // refetch predictions whenever the next user action is another pick. This
      // is what keeps bot picks honest within a pack: without it, every seat
      // reuses the predictions computed at pack-open, and once packs pass the
      // stored predictions are for cards that have already left the pack —
      // findIndex returns -1 and bots fall back to random selection.
      const upcomingStep = newState.stepQueue[0];
      const needsRefresh =
        upcomingStep &&
        (upcomingStep.action === 'pick' ||
          upcomingStep.action === 'trash' ||
          upcomingStep.action === 'pickrandom' ||
          upcomingStep.action === 'trashrandom') &&
        newState.seats[0].pack.length > 0;

      if (needsRefresh) {
        const request = {
          state: newState,
          packCards: newState.seats[0].pack
            .map((index) => {
              const card = draft.cards[index];
              const voucherOracleIds =
                isVoucher(card) && card?.voucher_cards
                  ? card.voucher_cards.map((vc) => vc.details?.oracle_id).filter((id): id is string => Boolean(id))
                  : undefined;
              return {
                index,
                oracle_id: card?.details?.oracle_id || '',
                voucherOracleIds,
              };
            })
            .filter(
              (card) => Boolean(card.oracle_id) || Boolean(card.voucherOracleIds && card.voucherOracleIds.length > 0),
            ),
        };

        await getPredictions(request);
      }

      dispatch({ type: 'replaceState', state: newState });
      setDraftStatus((prev) => ({ ...prev, loading: false }));
    },
    [state, dispatch, currentPredictions, draft.cards, draft.seats.length, draft.InitialState, getPredictions],
  );

  // Filter out any indices that don't resolve to a card so downstream renderers never
  // read `.cardID` off undefined. Filtering within each pile preserves row/col positions.
  const mainboardCards = mainboard.map((row) =>
    row.map((col) =>
      col.map((index) => draft.cards[index]).filter((c): c is NonNullable<typeof c> => c !== null && c !== undefined),
    ),
  );
  const sideboardCards = sideboard.map((row) =>
    row.map((col) =>
      col.map((index) => draft.cards[index]).filter((c): c is NonNullable<typeof c> => c !== null && c !== undefined),
    ),
  );

  // Function to handle initial drag, sets in the right place and sets it as pending if necessary
  const dragPickCard = useCallback(
    (source: DraftLocation, target: DraftLocation) => {
      if (pendingPick !== null) return;

      if (source.index < 0 || source.index >= state.seats[0].pack.length) return;

      const cardIndex = state.seats[0].pack[source.index];
      if (cardIndex === undefined || !draft.cards[cardIndex]) return;

      // For vouchers, expand into their contained cards instead of placing the voucher itself.
      // Use drag target's row/col for the first card, default placement for the rest.
      const boardEntries = expandPickForBoard(cardIndex).map((entry, index) =>
        index === 0 ? { ...entry, row: target.row, col: target.col } : entry,
      );
      const board = target.type === locations.deck ? 'deck' : 'sideboard';

      // Update the board immediately
      if (draftStatus.predictionsLoading) {
        setPendingPick({ packIndex: source.index, action: 'pick' });

        dispatch({ type: 'pickToBoard', board, entries: boardEntries });
      } else {
        dispatch({ type: 'pickToBoard', board, entries: boardEntries, pick: cardIndex });

        // Make the actual pick after the board update
        makePick(source.index);
      }
    },
    [
      draftStatus.predictionsLoading,
      draft.cards,
      makePick,
      pendingPick,
      setPendingPick,
      dispatch,
      state.seats,
      expandPickForBoard,
    ],
  );

  const dragCardBetweenDeckStacks = useCallback(
    (source: DraftLocation, target: DraftLocation) => {
      dispatch({ type: 'moveCard', source, target });
    },
    [dispatch],
  );

  // Clicking on a card in the pack adds it to mainboard and sets it as pending pick if necessary
  const clickPickCard = useCallback(
    (packIndex: number) => {
      if (packIndex < 0 || packIndex >= state.seats[0].pack.length) {
        return;
      }

      const cardIndex = state.seats[0].pack[packIndex];
      if (cardIndex === undefined) {
        return;
      }

      const card = draft.cards[cardIndex];
      if (!card) {
        return;
      }

      // For vouchers, expand into their contained cards instead of placing the voucher itself
      const boardEntries = expandPickForBoard(cardIndex);

      if (draftStatus.predictionsLoading) {
        dispatch({ type: 'pickToBoard', board: 'deck', entries: boardEntries });
        setPendingPick({ packIndex, action: 'pick' });
      } else {
        dispatch({ type: 'pickToBoard', board: 'deck', entries: boardEntries, pick: cardIndex });

        makePick(packIndex);
      }
    },
    [state.seats, draft.cards, makePick, draftStatus.predictionsLoading, dispatch, setPendingPick, expandPickForBoard],
  );

  /*
   * Clicking on a card within either deck stack moves it to the other. Unlike a drag where we have different source and targets,
   * on a click we only have the source. We determine the target location based on the source card's cmc/type (getCardDefaultRowColumn)
   * though if moving to the sideboard only the CMC matters to determine the column.
   */
  const clickDeckStack = useCallback(
    (source: DraftLocation) => {
      //Determine the card which was clicked in the board, so we can calculate its standard row/col destination
      const sourceBoard = getLocationReferences(source.type);
      const cardIndex = sourceBoard[source.row][source.col][source.index];
      const card = draft.cards[cardIndex];
      const { row, col } = getCardDefaultRowColumn(card);

      const targetLocation = source.type === locations.deck ? locations.sideboard : locations.deck;
      //The sideboard only has one row, unlike the deck with has 1 row for creatures and 1 for non-creatures
      const targetRow = targetLocation === locations.sideboard ? 0 : row;
      const targetBoard = getLocationReferences(targetLocation);

      //The card should be added to the end of the stack of cards at the grid position (row/col). Be extra careful
      //with the boards (using .? operator) even though they are pre-populated via setupPicks() at the top
      const targetIndex = targetBoard?.[targetRow]?.[col]?.[source.index] || 0;
      dragCardBetweenDeckStacks(source, new DraftLocation(targetLocation, targetRow, col, targetIndex));
    },
    [draft.cards, getLocationReferences, dragCardBetweenDeckStacks],
  );

  const clickTrashPick = useCallback(
    (packIndex: number) => {
      const cardIndex = state.seats[0].pack[packIndex];
      if (cardIndex === undefined || !draft.cards[cardIndex]) return;

      if (draftStatus.predictionsLoading) {
        dispatch({ type: 'trashPick', cardIndex });
        setPendingPick({ packIndex, action: 'trash' });
      } else {
        dispatch({ type: 'trashPick', cardIndex });
        makePick(packIndex);
      }
    },
    [state.seats, draft.cards, draftStatus.predictionsLoading, dispatch, makePick],
  );

  const onMoveCard = useCallback(
    async (event: any) => {
      const { active, over } = event;
      //If drag and drop ends without a collision, eg outside the drag/drop area, do nothing
      if (!over) return;
      // Can't make changes while drafting is over until deckbuilding to avoid weird timing issues
      if (draftStatus.draftCompleted) return;

      const source = active.data.current as DraftLocation;
      const target = over.data.current as DraftLocation;

      // Trash picks just don't go to the mainboard or sideboard
      if (state.stepQueue[0]?.action === 'trash' && source.type === locations.pack) {
        clickTrashPick(source.index);
        return;
      }

      if (source.equals(target) && source.type === locations.pack) {
        // player dropped card back in the same location
        const dragTime = Date.now() - (dragStartTime ?? 0);
        if (dragTime < 200) {
          // If the drag was quick, treat it as a click
          return clickPickCard(source.index);
        }
        return;
      } else if (source.equals(target) && (source.type === locations.deck || source.type === locations.sideboard)) {
        //Clicking a card within the deck or sideboard should move it from one to the other
        clickDeckStack(source);
        return;
      } else if (source.equals(target)) {
        return;
      }

      if (target.type === locations.pack) {
        return;
      }
      //Dragged a card from the pack to the deck or sideboard
      if (source.type === locations.pack) {
        if (target.type === locations.deck || target.type === locations.sideboard) {
          dragPickCard(source, target);
          return;
        }
      }
      //Otherwise the drag had nothing to do with the pack
      dragCardBetweenDeckStacks(source, target);
    },
    [
      clickDeckStack,
      dragStartTime,
      dragCardBetweenDeckStacks,
      clickPickCard,
      dragPickCard,
      draftStatus.draftCompleted,
      state.stepQueue,
      clickTrashPick,
    ],
  );

  // Converts pendingPicks into real picks when we're ready
  useEffect(() => {
    //Nothing to do if no pendingPick
    if (pendingPick === null) {
      return;
    }

    //Do not act on the pendingPick if predictions are ongoing or in a bad state
    if (draftStatus.predictError || draftStatus.retryInProgress) {
      console.log('Pending pick but draft state is bad, skip');
      return;
    }

    //If we have to wait for predictions, that's OK too
    if (draftStatus.predictionsLoading) {
      return;
    }

    const { packIndex, action } = pendingPick;
    // Clear pendingPick immediately to prevent race conditions
    setPendingPick(null);
    // Some checks to verify that the pending pick is still valid
    if (packIndex < 0 || packIndex >= state.seats[0].pack.length) {
      return;
    }

    const cardIndex = state.seats[0].pack[packIndex];
    //A trashed card was never picked, so it must not join the pick order
    if (action === 'pick') {
      dispatch({ type: 'recordPick', cardIndex });
    }
    if (cardIndex === undefined) {
      return;
    }

    if (!draft.cards[cardIndex]) {
      return;
    }

    makePick(packIndex);
  }, [
    draftStatus.predictionsLoading,
    draftStatus.predictError,
    draftStatus.retryInProgress,
    pendingPick,
    makePick,
    state.seats,
    draft.cards,
    setPendingPick,
    dispatch,
  ]);

  // Add a useEffect to handle ending the draft
  useEffect(() => {
    if (draftStatus.draftCompleted) {
      endDraft();
    }
  }, [draftStatus.draftCompleted, endDraft]);

  // this is the auto-pick logic
  useEffect(() => {
    if (
      state.stepQueue[0] &&
      (state.stepQueue[0].action === 'pickrandom' || state.stepQueue[0].action === 'trashrandom') &&
      state.seats[0].pack.length > 0 &&
      !draftStatus.loading
    ) {
      setDraftStatus((prev) => ({ ...prev, loading: true }));
      if (pendingPick !== null) return;
      setTimeout(() => {
        if (state.stepQueue[0]?.action === 'trashrandom') {
          // Emulate a trash click pick on a card from the pack, by picking a random index position within the available card pack
          clickTrashPick(Math.floor(Math.random() * state.seats[0].pack.length));
        } else {
          // Emulate clicking on a random card
          clickPickCard(Math.floor(Math.random() * state.seats[0].pack.length));
        }
      }, 1000);
    }
  }, [
    draftStatus.loading,
    state.stepQueue,
    state.seats,
    draftStatus.predictionsLoading,
    makePick,
    pendingPick,
    clickPickCard,
    clickTrashPick,
  ]);

  // P1P1 ratings fetch necessary, the rest come via makePick
  // InitialRatings could eventually come along with the initial state, would require some refactoring
  useEffect(() => {
    const fetchInitialRatings = async () => {
      if (state?.seats?.[0]?.pack?.length > 0) {
        const request = {
          state,
          packCards: state.seats[0].pack.map((index) => {
            const card = draft.cards[index];
            const voucherOracleIds =
              isVoucher(card) && card?.voucher_cards
                ? card.voucher_cards.map((vc) => vc.details?.oracle_id).filter((id): id is string => Boolean(id))
                : undefined;
            return {
              index,
              oracle_id: card?.details?.oracle_id || '',
              voucherOracleIds,
            };
          }),
        };
        await getPredictions(request);
      }
    };

    fetchInitialRatings();
  }, [draft.cards, state, getPredictions]);

  const packTitle: string = useMemo(() => {
    const nextStep = state.stepQueue[0];

    // The queue drains to empty on the final pick; nothing left to describe.
    if (!nextStep) return draftStatus.loading ? 'Finishing up draft...' : '';

    if (draftStatus.loading) {
      if (state.stepQueue.length <= 1) {
        return 'Finishing up draft...';
      }
      if (nextStep.action !== 'pickrandom' && nextStep.action !== 'trashrandom') return 'Waiting for next pack...';
    }

    switch (nextStep.action) {
      case 'pick':
        return `Pack ${state.pack} Pick ${state.pick}: Pick ${nextStep.amount} card${nextStep.amount && nextStep.amount > 1 ? 's' : ''}`;
      case 'trash':
        return `Pack ${state.pack} Pick ${state.pick}: Trash ${nextStep.amount} card${nextStep.amount && nextStep.amount > 1 ? 's' : ''}`;
      case 'endpack':
        return 'Waiting for next pack to open...';
      case 'pickrandom':
        return 'Picking random selection...';
      case 'trashrandom':
        return 'Trashing random selection...';
      default:
        return '';
    }
  }, [state, draftStatus.loading]);

  const packDisabled =
    state.stepQueue[0]?.action === 'pickrandom' ||
    state.stepQueue[0]?.action === 'trashrandom' ||
    draftStatus.predictError ||
    pendingPick !== null;

  // At pack 1 pick 1 the visible pack is still the full opened pack, so the user
  // can turn it into a shareable/votable P1P1 instead of screenshotting it.
  const isFirstPick = state.pack === 1 && state.pick === 1 && !draftStatus.loading;

  // Owned here rather than in Pack so the choice survives every pick and pack of this draft.
  const toggleRatings = useCallback(() => setShowRatings((prev) => !prev), []);

  return (
    <MainLayout useContainer={false}>
      <CubeLayout cube={cube} activeLink="playtest">
        <Container xl disableCenter>
          <Alerts alerts={alerts} />
          <DndContext onDragEnd={onMoveCard} onDragStart={() => setDragStartTime(Date.now())}>
            <div className="relative">
              {/* Only show the pack if there are actually cards to show */}
              {state?.seats?.[0]?.pack?.length > 0 ? (
                draftStatus.predictionsLoading && pendingPick !== null ? (
                  <Card className="mt-3">
                    <CardHeader className="flex justify-between items-center">
                      <Text semibold lg>
                        Waiting for Bot Picks...
                      </Text>
                    </CardHeader>
                    <CardBody>
                      <div className="centered py-3">
                        <div className="spinner" />
                      </div>
                    </CardBody>
                  </Card>
                ) : (
                  <Pack
                    // Just use state.seats[0].pack directly
                    pack={state.seats[0].pack.map((index) => draft.cards[index])}
                    packSize={state.seats[0].pack.length}
                    loading={draftStatus.loading}
                    title={packTitle}
                    disabled={packDisabled || draftStatus.retryInProgress}
                    ratings={ratings}
                    showRatings={showRatings}
                    onToggleRatings={toggleRatings}
                    error={draftStatus.predictError}
                    onRetry={handleRetryPredict}
                    retryInProgress={draftStatus.retryInProgress}
                    headerActions={
                      isFirstPick ? (
                        <P1P1FromPackGenerator
                          cubeId={cube.id}
                          seed={draft.id}
                          pack={state.seats[0].pack.map((index) => draft.cards[index])}
                          label="Share as P1P1"
                          openInNewTab
                        />
                      ) : undefined
                    }
                  />
                )
              ) : draftStatus.loading || draftStatus.draftCompleted ? (
                <Card className="mt-3">
                  <CardHeader>
                    <Text semibold lg>
                      Finishing draft...
                    </Text>
                  </CardHeader>
                  <CardBody>
                    <div className="flex justify-center py-3">
                      <Spinner md />
                    </div>
                  </CardBody>
                </Card>
              ) : (
                <></>
              )}
              <Card className="my-3">
                <DeckStacks
                  cards={mainboardCards}
                  title="Mainboard"
                  subtitle={makeSubtitle(mainboard.flat(3).map((index) => draft.cards[index]))}
                  locationType={locations.deck}
                  xs={4}
                  lg={8}
                />
                <DeckStacks cards={sideboardCards} title="Sideboard" locationType={locations.sideboard} xs={4} lg={8} />
              </Card>
            </div>
          </DndContext>
        </Container>
      </CubeLayout>
    </MainLayout>
  );
};

CubeDraftPage.displayName = 'CubeDraftPage';

export default RenderToRoot(CubeDraftPage);
