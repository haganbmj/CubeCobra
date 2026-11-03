import React, { createContext, ReactNode, useCallback, useContext, useMemo, useRef } from 'react';

// Measured legitimate worst case: a feed page returns up to 50 posts per request
// (`FeedDynamoDao.getByTo`'s default `limit = 50`, FeedDynamoDao.ts:170), and a `<<…>>` cardrow of
// five tiles is a legitimate single-line construct, not an attack (per the design spec). A reader
// who scrolls an entire feed page on which *every* post happens to cite a full five-pack cardrow
// reaches 50 * 5 = 250 embeds - already generous, since most posts reference zero packs.
//
// For scale, compare the attack this ceiling actually has to bound: a `[[p1p1:<uuid>]]` token with
// no caption is 45 characters (`[[p1p1:` + a 36-character uuid + `]]`), so a single post stuffed
// with bare tokens up to the 30,000-character blog cap (`cube/blog.ts:78-79`) fits ~666 of them;
// replicated across a full feed page that is 50 * 666 = 33,300.
//
// 500 sits comfortably above the measured legitimate case (2x) while remaining a small fraction
// (1.5%) of the attack case, and the near-viewport gate in `useNearViewport` means an ordinary page
// view consumes far fewer slots than this regardless - the budget only matters once a reader has
// actually scrolled past hundreds of resolving tiles.
export const MAX_PAGE_EMBEDS = 500;

interface EmbedBudgetContextValue {
  claim: (key: string) => boolean;
  // Separate from `claim`: `claim` answers "is there a page-wide slot for this key", shared (and
  // idempotent) across every embed of the same pack. `reserveFetch` answers a different question -
  // "am I, specifically, the embed that performs the network request for this key" - so that two
  // embeds of the same pack share one slot *and* one fetch, not one slot each with its own fetch.
  // Unlike `claim`, it is deliberately not idempotent: the first caller for a key wins and every
  // later caller for that same key loses, which is exactly what lets a duplicate embed skip
  // fetching instead of redoing the first embed's request.
  reserveFetch: (key: string) => boolean;
  // The embed that lost `reserveFetch` still needs *something* to render - the same success-or-
  // failure result the embed that won eventually produces, not a dead end. These three let the
  // winner publish that result once its own fetch settles, and let a loser read it (if it already
  // arrived) or subscribe to it (if it hasn't yet). Generic over the result's shape so a future
  // embed type can reuse this without the budget context knowing what that shape is.
  publishFetchResult: <T>(key: string, result: T) => void;
  getFetchResult: <T>(key: string) => T | undefined;
  subscribeFetchResult: <T>(key: string, onResult: (result: T) => void) => () => void;
}

// Used only when no provider is mounted - e.g. a component rendered standalone in a test that
// doesn't care about the budget. Grants everything unconditionally so such a component behaves
// exactly as it did before this budget existed, rather than silently gating a fetch nothing asked
// it to bound. Production always mounts `EmbedBudgetContextProvider` once, in `RenderToRoot`.
// `reserveFetch` always granting ownership here means the publish/subscribe path is simply never
// reached without a provider, so its no-op implementations below are unreachable in practice.
const defaultValue: EmbedBudgetContextValue = {
  claim: () => true,
  reserveFetch: () => true,
  publishFetchResult: () => {},
  getFetchResult: () => undefined,
  subscribeFetchResult: () => () => {},
};

const EmbedBudgetContext = createContext<EmbedBudgetContextValue>(defaultValue);

export interface EmbedBudgetContextProviderProps {
  max?: number;
  children: ReactNode;
}

/**
 * A page-wide ceiling on how many distinct embeds may fetch their data, shared by every `Markdown`
 * instance on the page (mounted once, in `RenderToRoot`, inside `CSRFContextProvider`) so a feed of
 * many posts cannot fan out into an unbounded number of DynamoDB gets and S3 reads.
 */
export const EmbedBudgetContextProvider: React.FC<EmbedBudgetContextProviderProps> = ({
  max = MAX_PAGE_EMBEDS,
  children,
}) => {
  // Refs, not state: `claim` must answer synchronously, within the same render that calls it, so an
  // effect-driven counter (which would race multiple embeds mounting in the same commit) cannot be
  // used, and a state-backed counter would re-render every embed on the page on every claim.
  const granted = useRef<Set<string>>(new Set());
  const count = useRef(0);
  const fetchOwners = useRef<Set<string>>(new Set());
  const results = useRef<Map<string, unknown>>(new Map());
  const subscribers = useRef<Map<string, Set<(result: unknown) => void>>>(new Map());

  const claim = useCallback(
    (key: string): boolean => {
      if (granted.current.has(key)) return true;
      if (count.current >= max) return false;
      granted.current.add(key);
      count.current += 1;
      return true;
    },
    [max],
  );

  const reserveFetch = useCallback((key: string): boolean => {
    if (fetchOwners.current.has(key)) return false;
    fetchOwners.current.add(key);
    return true;
  }, []);

  const publishFetchResult = useCallback(<T,>(key: string, result: T): void => {
    results.current.set(key, result);
    const subs = subscribers.current.get(key);
    if (!subs) return;
    // Snapshot before notifying: a subscriber's own cleanup (unmounting in response to the result)
    // mutating `subs` mid-iteration would otherwise skip or double-notify the remaining entries.
    [...subs].forEach((onResult) => onResult(result));
  }, []);

  const getFetchResult = useCallback(<T,>(key: string): T | undefined => results.current.get(key) as T | undefined, []);

  const subscribeFetchResult = useCallback(<T,>(key: string, onResult: (result: T) => void): (() => void) => {
    const wrapped = onResult as (result: unknown) => void;
    let subs = subscribers.current.get(key);
    if (!subs) {
      subs = new Set();
      subscribers.current.set(key, subs);
    }
    subs.add(wrapped);
    return () => {
      const current = subscribers.current.get(key);
      if (!current) return;
      current.delete(wrapped);
      // Don't leave an empty Set keyed in the map once its last subscriber has gone - the map
      // otherwise grows one entry per distinct pack id ever embedded on the page and never shrinks.
      if (current.size === 0) subscribers.current.delete(key);
    };
  }, []);

  const value = useMemo(
    () => ({ claim, reserveFetch, publishFetchResult, getFetchResult, subscribeFetchResult }),
    [claim, reserveFetch, publishFetchResult, getFetchResult, subscribeFetchResult],
  );

  return <EmbedBudgetContext.Provider value={value}>{children}</EmbedBudgetContext.Provider>;
};

export const useEmbedBudget = (): EmbedBudgetContextValue => useContext(EmbedBudgetContext);
