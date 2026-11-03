import React from 'react';

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

/**
 * Renders a `[[p1p1:<id>]]` embed token as a live tile: fetches the pack via `useP1P1Pack` and shows
 * a loading skeleton, the resolved tile, or - if the pack can't be resolved - the original token
 * text, all inside the same frame.
 *
 * `inTable` and `inParagraph` both pick a `span`-based wrapper, the same way `renderCardImage` does
 * in Markdown.tsx: the token is inline, so a block element (`div`) nested in a table cell or a
 * paragraph (both of which render their content inline, inside a `<p>` in the paragraph case) is
 * invalid HTML that React misnests.
 */
const P1P1Embed: React.FC<P1P1EmbedProps> = ({ id, caption, inTable, inParagraph }) => {
  const { pack, votes, cube, loading, error } = useP1P1Pack(id);
  const Tag = inTable || inParagraph ? 'span' : 'div';
  const frameClass =
    inTable || inParagraph
      ? 'inline-block border border-border bg-bg-active p-4'
      : 'border border-border bg-bg-active p-4';

  if (loading) {
    return (
      <Tag data-testid="p1p1-embed" data-pack-id={id} className={frameClass}>
        <Tag data-testid="p1p1-embed-skeleton" className="block h-56 w-full animate-pulse bg-bg-accent rounded" />
      </Tag>
    );
  }

  if (error || !pack || !votes || !cube) {
    return (
      <Tag data-testid="p1p1-embed" data-pack-id={id} className={frameClass}>
        {tokenText(id, caption)}
      </Tag>
    );
  }

  return (
    <Tag data-testid="p1p1-embed" data-pack-id={id} className={frameClass}>
      {/* Task 6 wires the detail modal into this callback; for now expanding is a no-op. */}
      <P1P1EmbedTile pack={pack} votes={votes} cube={cube} caption={caption} onExpand={() => {}} />
    </Tag>
  );
};

export default P1P1Embed;
