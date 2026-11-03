import React, { useEffect, useRef, useState } from 'react';

import { P1P1Pack, P1P1VoteSummary } from '@utils/datatypes/P1P1Pack';

import Button from 'components/base/Button';
import { useEmbedBudget } from 'contexts/EmbedBudgetContext';
import useNearViewport from 'hooks/useNearViewport';
import useP1P1Pack from 'hooks/useP1P1Pack';

import P1P1EmbedTile from './P1P1EmbedTile';

export interface P1P1EmbedProps {
  id: string;
  caption?: string;
  inTable?: boolean;
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
  cube: { name: string; shortId: string } | null;
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
 * if the page hasn't already spent its budget on other embeds. Past the budget, the tile shows its
 * frame plus a "Load This" button that fetches directly, bypassing both checks - the reader can
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
const P1P1Embed: React.FC<P1P1EmbedProps> = ({ id, caption, inTable, inParagraph }) => {
  const ref = useRef<HTMLElement>(null);
  const nearViewport = useNearViewport(ref);
  const { claim, reserveFetch, publishFetchResult, getFetchResult, subscribeFetchResult } = useEmbedBudget();
  const [forceLoad, setForceLoad] = useState(false);
  const [decision, setDecision] = useState<'pending' | 'fetch' | 'declined'>('pending');
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    if (forceLoad) {
      // An explicit click always wins, regardless of any earlier decision - this is the bypass,
      // and it always fetches directly rather than subscribing to anyone else's result.
      setIsOwner(true);
      setDecision('fetch');
      return;
    }
    if (decision !== 'pending' || !nearViewport) return;
    if (!claim(id)) {
      setDecision('declined');
      return;
    }
    // `reserveFetch` is deliberately not idempotent - the first caller for a key wins and every
    // later caller for that same key loses - which is what lets a losing instance below recognize
    // it should subscribe to the winner's result instead of also fetching. Calling it more than
    // once per instance would make the winning instance itself lose on a later call, which is
    // exactly why this whole decision is made at most once, guarded by `decision !== 'pending'`.
    setIsOwner(reserveFetch(id));
    setDecision('fetch');
  }, [nearViewport, forceLoad, decision, claim, reserveFetch, id]);

  const shouldFetch = decision === 'fetch' && isOwner;
  const {
    pack: ownPack,
    votes: ownVotes,
    cube: ownCube,
    loading: ownLoading,
    error: ownError,
  } = useP1P1Pack(shouldFetch ? id : null);

  // Once the owning embed's own fetch settles, publish it for any duplicate embed of the same pack
  // elsewhere on the page. Guarded by `hasStartedFetch`: `useP1P1Pack`'s `loading` starts out
  // `false` for one render before its own effect flips it to `true`, so without this guard that
  // transient render would publish a bogus "resolved to nothing" result before the fetch has even
  // begun.
  const hasStartedFetch = useRef(false);
  useEffect(() => {
    if (!shouldFetch) return;
    if (ownLoading) {
      hasStartedFetch.current = true;
      return;
    }
    if (!hasStartedFetch.current) return;
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
  const votes = isOwner ? ownVotes : (sharedResult?.votes ?? null);
  const cube = isOwner ? ownCube : (sharedResult?.cube ?? null);
  const error = isOwner ? ownError : (sharedResult?.error ?? null);
  const loading = decision === 'fetch' && (isOwner ? ownLoading : !sharedResult);

  const Tag = inTable || inParagraph ? 'span' : 'div';
  const frameClass =
    inTable || inParagraph
      ? 'inline-block border border-border bg-bg-active p-4'
      : 'border border-border bg-bg-active p-4';

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
      {/* Task 6 wires the detail modal into this callback; for now expanding is a no-op. */}
      <P1P1EmbedTile pack={pack} votes={votes} cube={cube} caption={caption} onExpand={() => {}} />
    </Tag>
  );
};

export default P1P1Embed;
