import React, { useEffect, useRef, useState } from 'react';

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
 * if the page hasn't already spent its budget on other embeds. Past the budget, or for a duplicate
 * embed of a pack another instance on the page is already fetching, the tile shows its frame plus a
 * "Load This" button that fetches directly, bypassing both checks - the reader can always get the
 * content, it just costs a click.
 */
const P1P1Embed: React.FC<P1P1EmbedProps> = ({ id, caption, inTable, inParagraph }) => {
  const ref = useRef<HTMLElement>(null);
  const nearViewport = useNearViewport(ref);
  const { claim, reserveFetch } = useEmbedBudget();
  const [forceLoad, setForceLoad] = useState(false);
  const [decision, setDecision] = useState<'pending' | 'fetch' | 'declined'>('pending');

  useEffect(() => {
    if (forceLoad) {
      // An explicit click always wins, regardless of any earlier decision - this is the bypass.
      setDecision('fetch');
      return;
    }
    if (decision !== 'pending' || !nearViewport) return;
    // `claim`/`reserveFetch` must run at most once per instance: `reserveFetch` is deliberately not
    // idempotent (that is what lets a duplicate embed of the same pack recognize it lost the race
    // and skip fetching), so running it again on a later effect - e.g. one re-run because an
    // unrelated prop changed - would make the winning instance itself lose on the second call. The
    // `decision !== 'pending'` guard above is what keeps this a one-time decision.
    setDecision(claim(id) && reserveFetch(id) ? 'fetch' : 'declined');
  }, [nearViewport, forceLoad, decision, claim, reserveFetch, id]);

  const shouldFetch = decision === 'fetch';
  const { pack, votes, cube, loading, error } = useP1P1Pack(shouldFetch ? id : null);
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
