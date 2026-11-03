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
}

// Used only when no provider is mounted - e.g. a component rendered standalone in a test that
// doesn't care about the budget. Grants everything unconditionally so such a component behaves
// exactly as it did before this budget existed, rather than silently gating a fetch nothing asked
// it to bound. Production always mounts `EmbedBudgetContextProvider` once, in `RenderToRoot`.
const defaultValue: EmbedBudgetContextValue = {
  claim: () => true,
  reserveFetch: () => true,
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

  const value = useMemo(() => ({ claim, reserveFetch }), [claim, reserveFetch]);

  return <EmbedBudgetContext.Provider value={value}>{children}</EmbedBudgetContext.Provider>;
};

export const useEmbedBudget = (): EmbedBudgetContextValue => useContext(EmbedBudgetContext);
