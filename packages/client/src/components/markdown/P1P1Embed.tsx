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
 *
 * `inTable` picks a `span`-based wrapper, the same way `renderCardImage` does in Markdown.tsx: table
 * cells render their content inline (inside a `<p>`), and a block element (`div`) nested in a `<p>` is
 * invalid HTML that React misnests.
 */
const P1P1Embed: React.FC<P1P1EmbedProps> = ({ id, caption, inTable }) => {
  const Tag = inTable ? 'span' : 'div';
  const frameClass = inTable
    ? 'inline-block border border-border bg-bg-active p-4'
    : 'border border-border bg-bg-active p-4';
  const captionClass = inTable ? 'block text-xs mt-2' : 'text-xs mt-2';
  return (
    <Tag data-testid="p1p1-embed" data-pack-id={id} className={frameClass}>
      {caption && (
        <Tag data-testid="p1p1-embed-caption" className={captionClass}>
          {caption}
        </Tag>
      )}
    </Tag>
  );
};

export default P1P1Embed;
