/**
 * Characterization harness for `pages/CubeDraftPage`.
 *
 * Everything the page does not own is mocked here (and only here) so that the mocks are
 * registered before the page module is loaded. Tests import from this file only.
 *
 * The accessors deliberately read observable surfaces — rendered DOM and `localStorage` —
 * rather than component internals, so they keep working across the storage refactor they
 * exist to guard.
 */
import React from 'react';

import { act, render } from '@testing-library/react';

import '@testing-library/jest-dom';

import Card from '@utils/datatypes/Card';
import Cube from '@utils/datatypes/Cube';
import Draft from '@utils/datatypes/Draft';
import { State } from '@utils/datatypes/DraftState';

import DraftLocation from 'drafting/DraftLocation';
import { DraftStore, draftStoreKey } from 'drafting/draftStore';
import { readRecord } from 'utils/localStorage/record';

// `mock`-prefixed so babel-plugin-jest-hoist allows the factories below to reference them.
const mockDndHandlers: {
  onDragStart?: (event: any) => void;
  onDragEnd?: (event: any) => void;
} = {};

jest.mock('components/RenderToRoot', () => (component: any) => component);
jest.mock('layouts/MainLayout', () => ({ children }: any) => <div>{children}</div>);
jest.mock('layouts/CubeLayout', () => ({ children }: any) => <div>{children}</div>);
jest.mock('components/p1p1/P1P1FromPackGenerator', () => () => <div data-testid="p1p1-generator" />);
jest.mock('utils/analytics', () => ({ trackEvent: jest.fn() }));

jest.mock('@dnd-kit/core', () => ({
  ...jest.requireActual('@dnd-kit/core'),
  DndContext: ({ children, onDragStart, onDragEnd }: any) => {
    mockDndHandlers.onDragStart = onDragStart;
    mockDndHandlers.onDragEnd = onDragEnd;
    return <div>{children}</div>;
  },
}));

jest.mock('components/Pack', () => ({ pack, title, disabled, loading }: any) => (
  <div data-testid="pack" data-disabled={String(Boolean(disabled))} data-loading={String(Boolean(loading))}>
    <div data-testid="pack-title">{title}</div>
    {pack.map((card: any, index: number) => (
      <div key={index} data-testid="pack-card" data-index={index} data-name={card?.details?.name ?? ''}>
        {card?.details?.name ?? ''}
      </div>
    ))}
  </div>
));

jest.mock('components/DeckStacks', () => ({ cards, locationType }: any) => (
  <div data-testid={`stacks-${locationType}`}>
    {cards.flatMap((row: any[], rowIndex: number) =>
      row.flatMap((col: any[], colIndex: number) =>
        col.map((card: any, index: number) => (
          <div
            key={`${rowIndex}-${colIndex}-${index}`}
            data-testid={`${locationType}-card`}
            data-name={card?.details?.name ?? ''}
            data-row={rowIndex}
            data-col={colIndex}
            data-index={index}
          >
            {card?.details?.name ?? ''}
          </div>
        )),
      ),
    )}
  </div>
));

// Kept below the mocks for readability — babel-plugin-jest-hoist lifts every `jest.mock`
// above the imports of this module, and because the page is imported *here* rather than from
// the test file, it is always loaded with the mocks already registered.
import { CSRFContext } from 'contexts/CSRFContext';

import CubeDraftPage from '../../src/pages/CubeDraftPage';

export const DRAFT_ID = 'draft-under-test';
export const CUBE_ID = 'cube-under-test';

/**
 * The URL the page navigates to once a draft is finished. Test files must set the jsdom
 * document URL to this value (see `resetDraftPageEnvironment`).
 */
export const DECKBUILDER_URL = `http://localhost/draft/deckbuilder/${DRAFT_ID}`;

export const SEAT_COUNT = 8;
export const PACKS_PER_SEAT = 2;
export const CARDS_PER_PACK = 3;

/**
 * The five flat keys the page used to write, one per `useLocalStorage` atom. The page now
 * writes a single {@link DRAFT_RECORD_KEY} record instead, so these are kept only so tests
 * can assert that nothing writes them any more.
 */
export const storageKeys = {
  state: `draftstate-${DRAFT_ID}`,
  mainboard: `mainboard-${DRAFT_ID}`,
  sideboard: `sideboard-${DRAFT_ID}`,
  trashboard: `trashboard-${DRAFT_ID}`,
  picks: `picks-${DRAFT_ID}`,
};

/** The one record the whole draft is stored under. */
export const DRAFT_RECORD_KEY = draftStoreKey(DRAFT_ID);

export const cardName = (index: number): string => `Card ${String(index).padStart(2, '0')}`;

/**
 * Card index layout: `seat * PACKS_PER_SEAT * CARDS_PER_PACK + pack * CARDS_PER_PACK + slot`.
 * Seat 0's first pack is therefore [0, 1, 2] and its second pack [3, 4, 5].
 */
export const cardIndexFor = (seat: number, pack: number, slot: number): number =>
  seat * PACKS_PER_SEAT * CARDS_PER_PACK + pack * CARDS_PER_PACK + slot;

// Three repeating shapes so picked cards land in distinct mainboard cells:
// creature/cmc 1 -> (row 0, col 1), instant/cmc 2 -> (row 1, col 2), creature/cmc 3 -> (row 0, col 3).
const CARD_SHAPES = [
  { type_line: 'Creature — Human Soldier', cmc: 1 },
  { type_line: 'Instant', cmc: 2 },
  { type_line: 'Creature — Elf Druid', cmc: 3 },
];

const buildCards = (): Card[] => {
  const total = SEAT_COUNT * PACKS_PER_SEAT * CARDS_PER_PACK;
  return Array.from({ length: total }, (_unused, index) => {
    const shape = CARD_SHAPES[index % CARD_SHAPES.length]!;
    return {
      cardID: `scryfall-${index}`,
      type_line: shape.type_line,
      cmc: shape.cmc,
      details: {
        name: cardName(index),
        oracle_id: `oracle-${index}`,
        scryfall_id: `scryfall-${index}`,
        type: shape.type_line,
        cmc: shape.cmc,
        image_normal: `https://example.invalid/${index}.jpg`,
      },
    } as unknown as Card;
  });
};

/**
 * Two picks and a trash per pack. The interleaved `pass` steps are what real formats
 * produce (`buildDefaultSteps`), and they are what advances `state.pick`.
 */
const packSteps = (): any[] => [
  { action: 'pick', amount: 1 },
  { action: 'pass', amount: 1 },
  { action: 'pick', amount: 1 },
  { action: 'pass', amount: 1 },
  { action: 'trash', amount: 1 },
];

export const buildDraft = (overrides: Partial<Draft> = {}): Draft =>
  ({
    id: DRAFT_ID,
    cube: CUBE_ID,
    type: 'd',
    name: 'Characterization Draft',
    date: 0,
    complete: false,
    basics: [],
    cubeOwner: 'owner-id',
    cards: buildCards(),
    seats: Array.from({ length: SEAT_COUNT }, (_unused, seat) => ({
      mainboard: [],
      sideboard: [],
      bot: seat !== 0,
      name: seat === 0 ? 'Player' : `Bot ${seat}`,
    })),
    InitialState: Array.from({ length: SEAT_COUNT }, (_unused, seat) =>
      Array.from({ length: PACKS_PER_SEAT }, (_unusedPack, pack) => ({
        cards: Array.from({ length: CARDS_PER_PACK }, (_unusedSlot, slot) => cardIndexFor(seat, pack, slot)),
        steps: packSteps(),
      })),
    ),
    ...overrides,
  }) as unknown as Draft;

export const buildCube = (overrides: Partial<Cube> = {}): Cube =>
  ({
    id: CUBE_ID,
    shortId: CUBE_ID,
    name: 'Characterization Cube',
    owner: 'owner-id',
    visibility: 'pu',
    ...overrides,
  }) as unknown as Cube;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

const defer = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

export interface PredictRequest {
  inputs: { pack: string[]; picks: string[] }[];
}

/**
 * Ratings mirror the requested pack order so the highest-rated oracle id is always present
 * in the seat's pack. That keeps bot picks deterministic (every bot takes its pack's first
 * card) and avoids the page's random fallback, which also logs to the console.
 */
const buildPrediction = (request: PredictRequest) => ({
  prediction: request.inputs.map((input) =>
    input.pack.map((oracle, position) => ({ oracle, rating: 1 / (position + 1) })),
  ),
});

export interface FinishRequest {
  url: string;
  body: {
    state: State;
    mainboard: number[][][];
    sideboard: number[][][];
  };
}

export interface CardPosition {
  name: string;
  row: number;
  col: number;
  index: number;
}

export interface DraftPageHarness {
  draft: Draft;
  cube: Cube;
  /** Fires `onDragStart` then `onDragEnd`; the elapsed time is well under the page's 200ms click threshold. */
  dragEnd: (source: DraftLocation, target: DraftLocation) => Promise<void>;
  /** Flushes pending promises and effects inside `act`. */
  flush: () => Promise<void>;
  getPackTitle: () => string;
  getPackCards: () => string[];
  isPackRendered: () => boolean;
  getMainboard: () => string[];
  getMainboardPositions: () => CardPosition[];
  getSideboard: () => string[];
  getSideboardPositions: () => CardPosition[];
  /** Trashed cards are never rendered; the stored draft record is the only observable surface. */
  getTrashboard: () => string[];
  getPicks: () => number[];
  getStoredDraft: () => State | null;
  /** The whole stored draft record, or null if the page has not written one yet. */
  getStoredStore: () => DraftStore | null;
  getStored: (key: string) => any;
  /** Resolves every outstanding `/api/draftbots/batchpredict` call. */
  resolvePredictions: () => Promise<void>;
  pendingPredictionCount: () => number;
  predictRequests: () => PredictRequest[];
  finishRequests: () => FinishRequest[];
  /** Click-picks the first pack card until the draft posts to `/draft/finish/:id`; returns that request. */
  finishDraft: () => Promise<FinishRequest>;
  /** What `finishDraft` did, in order: the action the pack asked for and the card it acted on. */
  playLog: () => { action: 'pick' | 'trash'; name: string; index: number }[];
}

export interface RenderDraftPageOptions {
  draft?: Draft;
  cube?: Cube;
  /** Leave `/api/draftbots/batchpredict` unresolved so tests can exercise the in-flight path. */
  holdPredictions?: boolean;
  /** Seed `localStorage` before mount. */
  storage?: Record<string, unknown>;
}

export const renderDraftPage = async (options: RenderDraftPageOptions = {}): Promise<DraftPageHarness> => {
  if (window.location.href !== DECKBUILDER_URL) {
    throw new Error(
      `Test file must declare @jest-environment-options {"url": "${DECKBUILDER_URL}"} — jsdom's ` +
        'location cannot be stubbed, and the page assigns it when a draft finishes.',
    );
  }

  const draft = options.draft ?? buildDraft();
  const cube = options.cube ?? buildCube();

  for (const [key, value] of Object.entries(options.storage ?? {})) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  const predictRequests: PredictRequest[] = [];
  const pending: { request: PredictRequest; deferred: Deferred<Response> }[] = [];
  const finishRequests: FinishRequest[] = [];

  const predictResponse = (request: PredictRequest): Response =>
    ({
      ok: true,
      status: 200,
      json: async () => buildPrediction(request),
    }) as unknown as Response;

  const fetchMock = jest.fn(async (input: any, init: any) => {
    const url = typeof input === 'string' ? input : String(input);
    if (url === '/api/draftbots/batchpredict') {
      const request = JSON.parse(init.body) as PredictRequest;
      predictRequests.push(request);
      if (!options.holdPredictions) {
        return predictResponse(request);
      }
      const deferred = defer<Response>();
      pending.push({ request, deferred });
      return deferred.promise;
    }
    throw new Error(`Unexpected fetch to ${url}`);
  });
  (global as any).fetch = fetchMock;

  const csrfFetch = jest.fn(async (input: any, init: any) => {
    const url = typeof input === 'string' ? input : String(input);
    if (url === `/draft/finish/${draft.id}`) {
      finishRequests.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }
    throw new Error(`Unexpected csrfFetch to ${url}`);
  });

  const csrfValue = {
    csrfToken: 'test-token',
    csrfFetch: csrfFetch as any,
    callApi: (async () => {
      throw new Error('callApi not used by CubeDraftPage');
    }) as any,
  };

  let container!: HTMLElement;
  await act(async () => {
    const result = render(
      <CSRFContext.Provider value={csrfValue}>
        <CubeDraftPage cube={cube} draft={draft} />
      </CSRFContext.Provider>,
    );
    container = result.container;
  });

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  const readStacks = (locationType: string): CardPosition[] =>
    Array.from(container.querySelectorAll(`[data-testid="${locationType}-card"]`)).map((element) => ({
      name: element.getAttribute('data-name') ?? '',
      row: Number(element.getAttribute('data-row')),
      col: Number(element.getAttribute('data-col')),
      index: Number(element.getAttribute('data-index')),
    }));

  const getStored = (key: string) => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  };

  const getStoredStore = (): DraftStore | null => readRecord<DraftStore>(DRAFT_RECORD_KEY)?.data ?? null;

  const namesFor = (indices: number[] | null): string[] => (indices ?? []).map((index) => cardName(index));

  const playLog: { action: 'pick' | 'trash'; name: string; index: number }[] = [];
  const indexForName = (name: string) => draft.cards.findIndex((card) => card.details?.name === name);

  const harness: DraftPageHarness = {
    draft,
    cube,
    flush,
    dragEnd: async (source, target) => {
      await act(async () => {
        mockDndHandlers.onDragStart?.({ active: { id: source.toString(), data: { current: source } } });
      });
      await act(async () => {
        await mockDndHandlers.onDragEnd?.({
          active: { id: source.toString(), data: { current: source } },
          over: { id: target.toString(), data: { current: target } },
        });
      });
      await flush();
    },
    getPackTitle: () => container.querySelector('[data-testid="pack-title"]')?.textContent ?? '',
    getPackCards: () =>
      Array.from(container.querySelectorAll('[data-testid="pack-card"]')).map(
        (element) => element.getAttribute('data-name') ?? '',
      ),
    isPackRendered: () => container.querySelector('[data-testid="pack"]') !== null,
    getMainboard: () => readStacks('deck').map((entry) => entry.name),
    getMainboardPositions: () => readStacks('deck'),
    getSideboard: () => readStacks('sideboard').map((entry) => entry.name),
    getSideboardPositions: () => readStacks('sideboard'),
    getTrashboard: () => namesFor(getStoredStore()?.trashboard ?? null),
    getPicks: () => getStoredStore()?.picks ?? [],
    getStoredDraft: () => getStoredStore()?.state ?? null,
    getStoredStore,
    getStored,
    pendingPredictionCount: () => pending.length,
    predictRequests: () => predictRequests,
    finishRequests: () => finishRequests,
    resolvePredictions: async () => {
      const outstanding = pending.splice(0, pending.length);
      await act(async () => {
        for (const entry of outstanding) {
          entry.deferred.resolve(predictResponse(entry.request));
        }
      });
      await flush();
    },
    finishDraft: async () => {
      // Guard against a step list that never drains rather than hanging the suite.
      for (let attempt = 0; attempt < 32 && finishRequests.length === 0; attempt += 1) {
        const name = harness.getPackCards()[0];
        if (name === undefined) {
          throw new Error('Pack is empty but the draft has not finished');
        }
        playLog.push({
          action: harness.getPackTitle().includes('Trash') ? 'trash' : 'pick',
          name,
          index: indexForName(name),
        });
        await harness.dragEnd(DraftLocation.pack(0), DraftLocation.pack(0));
      }
      const request = finishRequests[0];
      if (!request) {
        throw new Error('Draft never posted to /draft/finish');
      }
      return request;
    },
    playLog: () => playLog,
  };

  return harness;
};

/**
 * Per-test reset. Call from `beforeEach`.
 *
 * Note: the page assigns `window.location.href = '/draft/deckbuilder/<id>'` when a draft
 * finishes, and jsdom's `location` is non-configurable so it cannot be stubbed. Tests instead
 * run with the document URL already set to {@link DECKBUILDER_URL} via a
 * `@jest-environment-options` docblock, which makes that assignment a same-URL no-op rather
 * than a "Not implemented: navigation" error.
 */
export const resetDraftPageEnvironment = (): void => {
  window.localStorage.clear();
  mockDndHandlers.onDragStart = undefined;
  mockDndHandlers.onDragEnd = undefined;
  jest.clearAllMocks();
};
