import React, { useEffect, useRef, useState } from 'react';

import { P1P1Pack, P1P1VoteSummary } from '@utils/datatypes/P1P1Pack';

import Button from 'components/base/Button';
import { useEmbedBudget } from 'contexts/EmbedBudgetContext';
import useNearViewport from 'hooks/useNearViewport';
import useP1P1Pack from 'hooks/useP1P1Pack';
import { readPack } from 'utils/p1p1PackCache';

import P1P1EmbedModal from './P1P1EmbedModal';
import P1P1EmbedTile from './P1P1EmbedTile';

export interface P1P1EmbedProps {
  id: string;
  caption?: string;
  inTable?: boolean;
  inCardrow?: boolean;
  inParagraph?: boolean;
}

// Reconstructs the original `[[p1p1:<id>]]` / `[[p1p1:<id>|<caption>]]` token source. `P1P1Embed`
// only ever receives the already-split id/caption, not the raw text, so an unresolvable pack (fetch
// error, or a 404 that leaves pack/votes/cube null) falls back to re-assembling it rather than
// showing nothing - the same "render the token as plain text" behavior the parser itself falls back
// to for a malformed id. `caption !== undefined` (rather than a truthiness check) so an explicit,
// intentionally-empty caption (`[[p1p1:<id>|]]`) still reconstructs with its trailing pipe.
const tokenText = (id: string, caption?: string): string =>
  caption !== undefined ? `[[p1p1:${id}|${caption}]]` : `[[p1p1:${id}]]`;

// Normalizes an explicitly-empty caption (`[[p1p1:<id>|]]`, or one that's whitespace only) to
// `undefined` for display: the raw `caption` prop is left untouched (see `tokenText` above, which
// needs the empty string to round-trip the fallback token faithfully), but `P1P1EmbedTile` and
// `P1P1EmbedModal` should both treat "nothing meaningful after the pipe" the same as "no pipe at
// all" - no caption element in the tile, and the modal header falling back to the cube's name.
const displayCaption = (caption?: string): string | undefined =>
  caption !== undefined && caption.trim() !== '' ? caption : undefined;

// Sized to the resolved tile's actual content, not just the card grid it wraps, so a post does not
// jump as embeds resolve (the preview grid itself is capped at `max-h-56` = 224px, which is only
// one row of `P1P1EmbedTile`, not the whole tile). Measured from that tile's own rows, each in a
// `gap-2` (8px) flex column: caption + cube name + call-to-action are default text size (24px line
// height each), attribution + vote count are `text-xs` (16px line height each), plus the 224px card
// grid - 72 + 32 + 224 = 328px of content, plus 5 gaps between the 6 rows (40px) = 368px, i.e.
// `23rem`.
const SKELETON_HEIGHT_CLASS = 'h-[23rem]';

// What `useP1P1Pack` ultimately settles to for a given pack id. Shared through `EmbedBudgetContext`
// so a duplicate embed of the same pack - the one that lost `reserveFetch` - can render the exact
// same success-or-failure result the embed that actually fetched it produced, rather than being
// left with nothing or independently refetching.
interface P1P1FetchResult {
  pack: P1P1Pack | null;
  votes: P1P1VoteSummary | null;
  cube: { id: string; name: string; shortId: string } | null;
  error: string | null;
}

// Mirrors `useP1P1Pack`'s own fetch + parse logic exactly, as a plain (non-hook) function. Used
// only as a recovery path: if the owning embed unmounts before its own `useP1P1Pack`-driven fetch
// settles (e.g. `TextEntry`'s Preview/Source tabs unmount `Markdown` entirely on every switch), no
// component is left to observe that fetch's outcome, and `reserveFetch` never re-grants the same
// key to a later embed - so without this, any subscriber (current or future) would wait forever on
// a key whose sole owner is gone. Being a plain function rather than a hook is what lets it be
// called from a `useEffect` cleanup, which cannot call hooks.
const fetchP1P1PackResult = async (id: string): Promise<P1P1FetchResult> => {
  try {
    const response = await fetch(`/tool/api/getp1p1/${id}`);
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to fetch P1P1 pack');
    }
    const data = await response.json();
    return { pack: data.pack, votes: data.votes, cube: data.cube, error: null };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    return { pack: null, votes: null, cube: null, error: errorMessage };
  }
};

/**
 * Renders a `[[p1p1:<id>]]` embed token as a live tile: fetches the pack via `useP1P1Pack` and shows
 * a loading skeleton, the resolved tile, or - if the pack can't be resolved - the original token
 * text, all inside the same frame.
 *
 * `inTable` and `inParagraph` both pick a `span`-based wrapper, the same way `renderCardImage` does
 * in Markdown.tsx: the token is inline, so a block element (`div`) nested in a table cell or a
 * paragraph (both of which render their content inline, inside a `<p>` in the paragraph case) is
 * invalid HTML that React misnests.
 *
 * Fetching is gated by a page-wide budget (`EmbedBudgetContext`) and by viewport proximity
 * (`useNearViewport`): an embed only asks for data once it has scrolled near the viewport, and only
 * if the page hasn't already spent its budget on other embeds. A pack already sitting in the
 * client-side cache (`p1p1PackCache.ts`) skips the budget check entirely - the budget bounds
 * fetches, and a cache hit doesn't cost one. Past the budget, the tile shows its frame plus a "Load
 * This" button that fetches directly, bypassing both checks - the reader can
 * always get the content, it just costs a click.
 *
 * A *duplicate* embed of a pack another embed on the page is already fetching is different: it is
 * still within budget (both share the one slot `claim` granted), it just isn't the one performing
 * the request. It subscribes to the fetching embed's result instead, and renders the identical
 * tile, or the identical unresolvable fallback, once that arrives - never its own "Load This",
 * which would wrongly suggest the reader lost something a click could fix.
 *
 * The owning embed can itself unmount before its fetch settles - e.g. switching `TextEntry`'s
 * Preview tab away and back unmounts and remounts `Markdown` entirely, and `reserveFetch` never
 * re-grants an already-owned key, so the fresh embed that remounts is a subscriber, not a new
 * owner. The cleanup effect below recovers from this with an independent fetch, so a subscriber -
 * present now or arriving later - is never left waiting on an owner that's gone.
 */
const P1P1Embed: React.FC<P1P1EmbedProps> = ({ id, caption, inTable, inCardrow, inParagraph }) => {
  const ref = useRef<HTMLDivElement>(null);
  const nearViewport = useNearViewport(ref);
  const { claim, reserveFetch, publishFetchResult, getFetchResult, subscribeFetchResult } = useEmbedBudget();
  const [forceLoad, setForceLoad] = useState(false);
  const [decision, setDecision] = useState<'pending' | 'fetch' | 'declined'>('pending');
  const [isOwner, setIsOwner] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  // Owner or subscriber, voting in the modal must update this instance's own tile - so the override
  // lives here rather than on whichever side happens to own the fetch, and takes precedence over
  // both `ownVotes` and a subscriber's `sharedResult.votes` once set.
  const [voteOverride, setVoteOverride] = useState<P1P1VoteSummary | null>(null);
  // Guard each decision path to run at most once per instance (refs, not `decision` state - see
  // the comment inside the effect below for why state can't be used for this).
  const normalDecidedRef = useRef(false);
  const forceLoadDecidedRef = useRef(false);

  // A pack's cards never change after it's generated, so a pack already sitting in IndexedDB can
  // skip the page's fetch budget entirely - the budget bounds *fetches*, and this embed doesn't
  // need to be one of the ones counted against it. A cached pack also gets the cheap request:
  // `useP1P1Pack` routes a hit to `/tool/api/p1p1votes`, which reads the pack's DynamoDB record
  // alone, instead of `getp1p1`, which also reads the S3 body. A request is still made either way,
  // because `votes` can never come from the cache. Checked once nearViewport flips true, same
  // gating cost as the decision below, and the decision effect waits on `cacheChecked` (this check
  // is async - IndexedDB - so its answer can't be known within the same tick nearViewport flips).
  const [cachedPack, setCachedPack] = useState<P1P1Pack | null>(null);
  const [cacheChecked, setCacheChecked] = useState(false);
  const cacheCheckedRef = useRef(false);

  useEffect(() => {
    if (cacheCheckedRef.current || !nearViewport) return;
    cacheCheckedRef.current = true;
    let cancelled = false;
    readPack(id).then((cached) => {
      if (cancelled) return;
      setCachedPack(cached);
      setCacheChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [nearViewport, id]);

  useEffect(() => {
    if (forceLoad) {
      if (forceLoadDecidedRef.current) return;
      forceLoadDecidedRef.current = true;
      // An explicit click always wins past the ceiling - `claim`'s result is intentionally
      // ignored, accepting the over-the-ceiling grant - but it still goes through `reserveFetch`
      // so two over-budget duplicates of the same pack, both force-loaded, still share one fetch:
      // only the first click to reserve becomes the owner, the second becomes a subscriber the
      // same way an ordinary (within-budget) duplicate would.
      claim(id);
      setIsOwner(reserveFetch(id));
      setDecision('fetch');
      return;
    }
    if (normalDecidedRef.current || !nearViewport || !cacheChecked) return;
    normalDecidedRef.current = true;
    if (cachedPack) {
      // Cache hit: skip `claim` entirely rather than spending a slot on a read that costs nothing
      // locally. Still goes through `reserveFetch` so duplicate embeds of the same cached pack
      // share one vote-summary request rather than each firing their own.
      setIsOwner(reserveFetch(id));
      setDecision('fetch');
      return;
    }
    if (!claim(id)) {
      setDecision('declined');
      return;
    }
    // `reserveFetch` is deliberately not idempotent - the first caller for a key wins and every
    // later caller for that same key loses - which is what lets a losing instance below recognize
    // it should subscribe to the winner's result instead of also fetching. Calling it more than
    // once per instance would make the winning instance itself lose on a later call, which is
    // exactly why both this and the `forceLoad` branch above are guarded to decide at most once
    // per instance (refs, not `decision` state, since reacting to `decision` changing would re-run
    // this same effect a second time the moment either branch sets it).
    setIsOwner(reserveFetch(id));
    setDecision('fetch');
  }, [nearViewport, forceLoad, claim, reserveFetch, id, cacheChecked, cachedPack]);

  const shouldFetch = decision === 'fetch' && isOwner;
  const {
    pack: ownPack,
    votes: ownVotes,
    cube: ownCube,
    loading: ownLoading,
    error: ownError,
  } = useP1P1Pack(shouldFetch ? id : null);

  // Once the owning embed's own fetch settles, publish it for any duplicate embed of the same pack
  // elsewhere on the page. Gated on `ownLoading` being false *and* at least one field having
  // resolved to something - not on observing a transient "loading flipped to true" render, which a
  // batched update (e.g. a fetch whose first `await` settles within the same microtask flush as a
  // prior one - the pack cache check adds exactly such a flush) can skip entirely. `useP1P1Pack`'s
  // untouched initial state is `loading: false` with every other field `null`, otherwise
  // indistinguishable from "resolved to nothing" without this check.
  useEffect(() => {
    if (!shouldFetch || ownLoading) return;
    if (ownPack === null && ownVotes === null && ownCube === null && ownError === null) return;
    publishFetchResult<P1P1FetchResult>(id, { pack: ownPack, votes: ownVotes, cube: ownCube, error: ownError });
  }, [shouldFetch, ownLoading, ownPack, ownVotes, ownCube, ownError, id, publishFetchResult]);

  // Recovery for the owner-unmounts-before-settling race: `isOwner` is read from a ref, not the
  // state variable directly, because this effect's dependency array is intentionally empty (its
  // cleanup must run only on unmount, not on every render) - an empty-dependency effect's closure
  // otherwise only ever sees the first render's values. `publishFetchResult`/`getFetchResult` are
  // stable across renders regardless, so they don't need the same treatment.
  const isOwnerRef = useRef(isOwner);
  isOwnerRef.current = isOwner;
  useEffect(() => {
    return () => {
      if (!isOwnerRef.current) return;
      if (getFetchResult<P1P1FetchResult>(id) !== undefined) return; // already settled - nothing to recover
      fetchP1P1PackResult(id).then((result) => publishFetchResult<P1P1FetchResult>(id, result));
    };
    // Intentionally empty - see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A duplicate never fetches on its own - it subscribes to the owning embed's result instead,
  // checking for one that already arrived first so a late subscriber doesn't wait forever for a
  // result that was published before it subscribed.
  const [sharedResult, setSharedResult] = useState<P1P1FetchResult | undefined>(undefined);
  useEffect(() => {
    if (decision !== 'fetch' || isOwner) return undefined;
    const existing = getFetchResult<P1P1FetchResult>(id);
    if (existing) {
      setSharedResult(existing);
      return undefined;
    }
    return subscribeFetchResult<P1P1FetchResult>(id, setSharedResult);
  }, [decision, isOwner, id, getFetchResult, subscribeFetchResult]);

  const pack = isOwner ? ownPack : (sharedResult?.pack ?? null);
  // A vote cast in this instance's own modal always wins over whatever the fetch (own or shared)
  // produced, regardless of which side of the owner/subscriber split this instance landed on.
  const votes = voteOverride ?? (isOwner ? ownVotes : (sharedResult?.votes ?? null));
  const cube = isOwner ? ownCube : (sharedResult?.cube ?? null);
  const error = isOwner ? ownError : (sharedResult?.error ?? null);
  const loading = decision === 'fetch' && (isOwner ? ownLoading : !sharedResult);

  const Tag = inTable || inParagraph ? 'span' : 'div';
  // A standalone tile takes the full body width. Inside a `<<...>>` cardrow it has to give that up
  // and claim a share instead, or flex-wrap puts every tile on its own line and the row that the
  // construct exists to produce never appears. Two across on small screens, three from `lg` - fewer
  // than the five a mockup can fit, because below about a third of the body width the pack's cards
  // stop being legible.
  const widthClass = inCardrow ? 'w-full sm:w-1/2 lg:w-1/3 p-2' : '';
  const frameClass =
    `${inTable || inParagraph ? 'inline-block ' : ''}border border-border bg-bg-active p-4 ${widthClass}`.trim();

  if (decision === 'declined') {
    return (
      <Tag ref={ref} data-testid="p1p1-embed" data-pack-id={id} className={frameClass}>
        <Button onClick={() => setForceLoad(true)}>Load This</Button>
      </Tag>
    );
  }

  if (decision === 'pending' || loading) {
    return (
      <Tag ref={ref} data-testid="p1p1-embed" data-pack-id={id} className={frameClass}>
        <Tag
          data-testid="p1p1-embed-skeleton"
          className={`block w-full animate-pulse bg-bg-accent rounded ${SKELETON_HEIGHT_CLASS}`}
        />
      </Tag>
    );
  }

  if (error || !pack || !votes || !cube) {
    return (
      <Tag ref={ref} data-testid="p1p1-embed" data-pack-id={id} className={frameClass}>
        {tokenText(id, caption)}
      </Tag>
    );
  }

  return (
    <Tag ref={ref} data-testid="p1p1-embed" data-pack-id={id} className={frameClass}>
      <P1P1EmbedTile
        pack={pack}
        votes={votes}
        cube={cube}
        caption={displayCaption(caption)}
        onExpand={() => setModalOpen(true)}
      />
      <P1P1EmbedModal
        pack={pack}
        votes={votes}
        cube={cube}
        caption={displayCaption(caption)}
        isOpen={modalOpen}
        setOpen={setModalOpen}
        onVoteUpdate={setVoteOverride}
      />
    </Tag>
  );
};

export default P1P1Embed;
