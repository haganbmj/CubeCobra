/**
 * `RenderToRoot` is the one function on every page's entry graph, so it is where a
 * once-per-page-load hook belongs. These tests pin the storage reaper being installed there:
 * expired records are gone by the time the page mounts, keys no family claims are untouched,
 * and a reaper that fails cannot keep the page from rendering.
 */
import React from 'react';

import { act } from '@testing-library/react';

import '@testing-library/jest-dom';

import { draftStoreKey } from 'drafting/draftStore';
import { RECORD_VERSION } from 'utils/localStorage/record';

/**
 * `mock`-prefixed so babel-plugin-jest-hoist allows the factory below to close over it.
 *
 * The real reaper runs for every test except the throwing one. It has to be mocked to make it
 * throw at all: `reapLocalStorage` catches its own failures, so no amount of rigging
 * `localStorage` from the outside can get an exception past it — and the point of that test is
 * the call site, not the reaper.
 */
const mockReap = { calls: 0, shouldThrow: false };

jest.mock('utils/localStorage/reap', () => {
  const actual = jest.requireActual('utils/localStorage/reap');
  return {
    ...actual,
    reapLocalStorage: (now: number) => {
      mockReap.calls += 1;
      if (mockReap.shouldThrow) {
        throw new Error('reaping exploded');
      }
      return actual.reapLocalStorage(now);
    },
  };
});

// Kept below the mock for readability — babel-plugin-jest-hoist lifts `jest.mock` above the
// imports, so the page module is always loaded with the mock already registered.
import RenderToRoot from 'components/RenderToRoot';

const DAY_MS = 24 * 60 * 60 * 1000;

/** One of the ~85 third-party advertising identifiers that share this origin with us. */
const THIRD_PARTY_KEY = '_iiq_fdata_1312496403';
const THIRD_PARTY_VALUE = '{"eids":"not ours to delete"}';

const Page = (): React.ReactElement => <div data-testid="page">page</div>;

const storeRecord = (key: string, writtenAt: number): void => {
  window.localStorage.setItem(key, JSON.stringify({ v: RECORD_VERSION, t: writtenAt, data: {} }));
};

const mountPage = async (): Promise<void> => {
  await act(async () => {
    RenderToRoot(Page);
  });
};

describe('RenderToRoot', () => {
  beforeEach(() => {
    mockReap.calls = 0;
    mockReap.shouldThrow = false;
    window.localStorage.clear();
    document.body.innerHTML = '<div id="react-root"></div>';
    window.reactProps = {};
  });

  it('reaps expired storage when a page mounts', async () => {
    const abandoned = draftStoreKey('abandoned-draft');
    const current = draftStoreKey('current-draft');
    // `cc:draft:` records live 30 days, measured from their own `t`.
    storeRecord(abandoned, Date.now() - 31 * DAY_MS);
    storeRecord(current, Date.now() - DAY_MS);

    await mountPage();

    expect(mockReap.calls).toBe(1);
    expect(window.localStorage.getItem(abandoned)).toBeNull();
    // The sweep is by age, not a blanket wipe: a draft still inside its TTL survives.
    expect(window.localStorage.getItem(current)).not.toBeNull();
  });

  it('leaves unrecognised keys alone when a page mounts', async () => {
    window.localStorage.setItem(THIRD_PARTY_KEY, THIRD_PARTY_VALUE);

    await mountPage();

    expect(mockReap.calls).toBe(1);
    expect(window.localStorage.getItem(THIRD_PARTY_KEY)).toBe(THIRD_PARTY_VALUE);
  });

  it('still renders the page when reaping throws', async () => {
    mockReap.shouldThrow = true;
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await mountPage();

      expect(mockReap.calls).toBe(1);
      expect(document.querySelector('[data-testid="page"]')).toBeInTheDocument();
      // Swallowed, not ignored.
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
