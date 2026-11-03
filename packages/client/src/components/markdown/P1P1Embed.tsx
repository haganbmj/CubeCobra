import React from 'react';

export interface P1P1EmbedProps {
  id: string;
  caption?: string;
  inTable?: boolean;
}

/**
 * Static placeholder frame for a `[[p1p1:<id>]]` embed token. This task only wires up parsing and a
 * minimal frame - fetching the pack's real contents, a richer tile, and the detail modal all land in
 * later tasks.
 */
const P1P1Embed: React.FC<P1P1EmbedProps> = ({ id, caption }) => (
  <div data-testid="p1p1-embed" data-pack-id={id} className="border border-border bg-bg-active p-4">
    {caption && (
      <div data-testid="p1p1-embed-caption" className="text-xs mt-2">
        {caption}
      </div>
    )}
  </div>
);

export default P1P1Embed;
