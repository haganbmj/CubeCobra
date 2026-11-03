import React from 'react';

import { act, render } from '@testing-library/react';

import '@testing-library/jest-dom';

// `components/Markdown` pulls in react-syntax-highlighter for code blocks, which depends on the
// ESM-only refractor. That is unrelated to Markdown parsing, so it is the one thing we stub; every
// other plugin in the pipeline runs for real.
jest.mock('react-syntax-highlighter', () => ({ __esModule: true, default: () => null }));
jest.mock('react-syntax-highlighter/dist/cjs/styles/hljs', () => ({ a11yDark: {}, a11yLight: {} }));

// This suite exercises token parsing/prop-wiring, not the data fetch itself (that's
// `P1P1EmbedTile.component.test.tsx`), so the hook is stubbed to resolve instantly and
// deterministically - otherwise every assertion here would race an unresolved `fetch` (undefined
// in jsdom) and observe whatever state that left the component in.
jest.mock('hooks/useP1P1Pack', () => ({ __esModule: true, default: jest.fn() }));

import Markdown from 'components/Markdown';
import useP1P1Pack from 'hooks/useP1P1Pack';

const mockedUseP1P1Pack = useP1P1Pack as jest.Mock;

const PACK_ID = '3e9d3a4e-1f1a-4e7d-9a3b-2d5f6a7c8b9d';
const OTHER_ID = '7c2b8f1a-4d5e-4a6b-8c9d-0e1f2a3b4c5d';

beforeEach(() => {
  mockedUseP1P1Pack.mockImplementation((packId: string) => ({
    pack: {
      id: packId,
      createdBy: 'user-1',
      cubeId: 'cube-1',
      date: 1700000000000,
      votesByUser: {},
      cards: [],
      createdByUsername: 'dekkerglen',
      seed: 'seed',
      source: 'random',
    },
    votes: { totalVotes: 0, results: [] },
    cube: { name: 'Test Cube', shortId: 'test' },
    loading: false,
    error: null,
    refetch: jest.fn(),
  }));
});

// Embeds are opt-in per surface (default off), so these tests - which exercise the token's own
// parsing/rendering behavior rather than the gate itself - render with `allowEmbeds` on throughout.
// The gate is covered separately below.
const renderMarkdown = async (markdown: string) => {
  const container = render(<Markdown markdown={markdown} allowEmbeds />).container;
  // `P1P1Embed` now checks the pack cache (`p1p1PackCache.ts`) before deciding to fetch, which adds
  // one async hop before its decision settles past the loading skeleton - flush it so callers can
  // assert on the resolved tile synchronously afterward.
  await act(() => Promise.resolve());
  return container;
};

describe('p1p1 embed token', () => {
  it('renders a tile for a p1p1 token', async () => {
    const c = await renderMarkdown(`[[p1p1:${PACK_ID}]]\n`);
    expect(c.querySelector('[data-testid="p1p1-embed"]')).toBeInTheDocument();
  });

  // The common authoring form - the token alone on its own line - parses as a paragraph whose only
  // child is the embed. Left wrapped, the frame would take the inline `inParagraph` span form, which
  // still nests the tile's own block content (the card grid) inside a `<p>` - exactly the invalid
  // nesting `inParagraph` exists to avoid, just one level further down. `cardlinks` unwraps this case
  // by replacing the paragraph with the embed itself, so the frame renders at the block level.
  it('unwraps a paragraph whose only content is a p1p1 token, rendering the tile at the block level', async () => {
    const c = await renderMarkdown(`[[p1p1:${PACK_ID}]]\n`);
    const tile = c.querySelector('[data-testid="p1p1-embed"]') as HTMLElement;
    expect(tile).toBeInTheDocument();
    expect(tile.tagName).toBe('DIV');
    expect(tile.closest('p')).toBeNull();
  });

  it('shows the caption after the pipe', async () => {
    const c = await renderMarkdown(`[[p1p1:${PACK_ID}|Sol Ring or Force of Will?]]\n`);
    expect(c.querySelector('[data-testid="p1p1-embed-caption"]')).toHaveTextContent('Sol Ring or Force of Will?');
  });

  it('keeps a caption containing pipes intact and does not corrupt the id', async () => {
    const c = await renderMarkdown(`[[p1p1:${PACK_ID}|Red, Blue | Green]]\n`);
    const tile = c.querySelector('[data-testid="p1p1-embed"]') as HTMLElement;
    expect(tile.dataset.packId).toBe(PACK_ID);
    expect(c.querySelector('[data-testid="p1p1-embed-caption"]')).toHaveTextContent('Red, Blue | Green');
  });

  it.each(['[[p1p1:]]', '[[p1p1:not-a-uuid]]'])('renders %s as plain text', async (token) => {
    const c = await renderMarkdown(`${token}\n`);
    expect(c.querySelector('[data-testid="p1p1-embed"]')).not.toBeInTheDocument();
    expect(c).toHaveTextContent(token);
  });

  it('still renders an ordinary card link', async () => {
    const c = await renderMarkdown('[[Sol Ring]]\n');
    expect(c.querySelector('a[href="/tool/card/Sol%20Ring"]')).toBeInTheDocument();
  });

  it('lays several tiles out in a row inside a cardrow', async () => {
    const c = await renderMarkdown(`<<[[p1p1:${PACK_ID}]][[p1p1:${OTHER_ID}]]>>\n`);
    expect(c.querySelectorAll('[data-testid="p1p1-embed"]')).toHaveLength(2);
  });

  // Without a width the tiles are full-bleed, so flex-wrap gives each its own line and the row the
  // construct exists to produce never appears.
  it('gives a tile in a cardrow a width so the row is actually a row', async () => {
    const c = await renderMarkdown(`<<[[p1p1:${PACK_ID}]][[p1p1:${OTHER_ID}]]>>\n`);
    const tiles = Array.from(c.querySelectorAll('[data-testid="p1p1-embed"]'));

    expect(tiles).toHaveLength(2);
    tiles.forEach((tile) => expect(tile).toHaveClass('sm:w-1/2', 'lg:w-1/3'));
  });

  it('leaves a standalone tile full width', async () => {
    const c = await renderMarkdown(`[[p1p1:${PACK_ID}]]\n`);
    const tile = c.querySelector('[data-testid="p1p1-embed"]') as HTMLElement;

    expect(tile).not.toHaveClass('sm:w-1/2');
  });

  // A cardrow renders a flex container, which is a block element, so a paragraph can no more hold
  // one than it can hold a tile - and `<<...>>` is the documented way to write a row of packs.
  it('lifts a cardrow out of its paragraph', async () => {
    const c = await renderMarkdown(`<<[[p1p1:${PACK_ID}]][[p1p1:${OTHER_ID}]]>>\n`);
    const tile = c.querySelector('[data-testid="p1p1-embed"]') as HTMLElement;

    expect(tile.closest('p')).toBeNull();
  });

  it('splits a paragraph around a tile written mid-sentence', async () => {
    const c = await renderMarkdown(`Before [[p1p1:${PACK_ID}]] after.\n`);
    const tile = c.querySelector('[data-testid="p1p1-embed"]') as HTMLElement;

    expect(tile.closest('p')).toBeNull();
    expect(c).toHaveTextContent('Before');
    expect(c).toHaveTextContent('after.');
  });

  // The token is inline, so an author can write it mid-sentence - but the tile it resolves to is a
  // block preview whose card grid renders divs, which a `<p>` cannot legally contain. An earlier
  // version kept it inside the paragraph and switched the frame to a `span`; that still left
  // `CardGrid`'s own divs nested in the `<p>`, and React logged a hydration error on every render.
  // The paragraph is now split around it instead, which removes the conflict rather than hiding it.
  it('lifts a tile written mid-sentence out of the paragraph entirely', async () => {
    const c = await renderMarkdown(`Check this pick: [[p1p1:${PACK_ID}]] what do you think?\n`);
    const tile = c.querySelector('[data-testid="p1p1-embed"]') as HTMLElement;

    expect(tile).toBeInTheDocument();
    expect(tile.closest('p')).toBeNull();
    expect(c).toHaveTextContent('Check this pick:');
    expect(c).toHaveTextContent('what do you think?');
  });
});

describe('per-surface embed gate', () => {
  it('renders the token as plain text when embeds are not allowed', () => {
    const c = render(<Markdown markdown={`[[p1p1:${PACK_ID}]]\n`} />).container;
    expect(c.querySelector('[data-testid="p1p1-embed"]')).not.toBeInTheDocument();
    expect(c).toHaveTextContent(`[[p1p1:${PACK_ID}]]`);
  });

  it('renders a tile when embeds are allowed', () => {
    const c = render(<Markdown markdown={`[[p1p1:${PACK_ID}]]`} allowEmbeds />).container;
    expect(c.querySelector('[data-testid="p1p1-embed"]')).toBeInTheDocument();
  });

  it('renders a tile in a table cell without nesting a block in a paragraph', () => {
    const c = render(<Markdown markdown={`| A |\n| :-: |\n| [[p1p1:${PACK_ID}]] |\n`} allowEmbeds />).container;
    const tile = c.querySelector('td [data-testid="p1p1-embed"]') as HTMLElement;
    expect(tile).toBeInTheDocument();
    expect(tile.closest('p')).toBeNull();
  });
});
