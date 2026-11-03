import React from 'react';

import { render } from '@testing-library/react';

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
const renderMarkdown = (markdown: string) => render(<Markdown markdown={markdown} allowEmbeds />).container;

describe('p1p1 embed token', () => {
  it('renders a tile for a p1p1 token', () => {
    const c = renderMarkdown(`[[p1p1:${PACK_ID}]]\n`);
    expect(c.querySelector('[data-testid="p1p1-embed"]')).toBeInTheDocument();
  });

  it('shows the caption after the pipe', () => {
    const c = renderMarkdown(`[[p1p1:${PACK_ID}|Sol Ring or Force of Will?]]\n`);
    expect(c.querySelector('[data-testid="p1p1-embed-caption"]')).toHaveTextContent('Sol Ring or Force of Will?');
  });

  it('keeps a caption containing pipes intact and does not corrupt the id', () => {
    const c = renderMarkdown(`[[p1p1:${PACK_ID}|Red, Blue | Green]]\n`);
    const tile = c.querySelector('[data-testid="p1p1-embed"]') as HTMLElement;
    expect(tile.dataset.packId).toBe(PACK_ID);
    expect(c.querySelector('[data-testid="p1p1-embed-caption"]')).toHaveTextContent('Red, Blue | Green');
  });

  it.each(['[[p1p1:]]', '[[p1p1:not-a-uuid]]'])('renders %s as plain text', (token) => {
    const c = renderMarkdown(`${token}\n`);
    expect(c.querySelector('[data-testid="p1p1-embed"]')).not.toBeInTheDocument();
    expect(c).toHaveTextContent(token);
  });

  it('still renders an ordinary card link', () => {
    const c = renderMarkdown('[[Sol Ring]]\n');
    expect(c.querySelector('a[href="/tool/card/Sol%20Ring"]')).toBeInTheDocument();
  });

  it('lays several tiles out in a row inside a cardrow', () => {
    const c = renderMarkdown(`<<[[p1p1:${PACK_ID}]][[p1p1:${OTHER_ID}]]>>\n`);
    expect(c.querySelectorAll('[data-testid="p1p1-embed"]')).toHaveLength(2);
  });

  // The token is inline, so an author can write it mid-sentence. A block `div` nested in a `<p>`
  // is invalid HTML (the same issue `renderCardImage`'s `inParagraph` flag already solves for
  // `cardimage`) - `oncard` carries the same flag onto the p1p1embed node so the frame picks a
  // span here too.
  it('renders inline in a paragraph without nesting a block element directly in the <p>', () => {
    const c = renderMarkdown(`Check this pick: [[p1p1:${PACK_ID}]] what do you think?\n`);
    const tile = c.querySelector('[data-testid="p1p1-embed"]') as HTMLElement;
    expect(tile).toBeInTheDocument();
    expect(tile.tagName).toBe('SPAN');
    expect(tile.closest('p')).not.toBeNull();
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
