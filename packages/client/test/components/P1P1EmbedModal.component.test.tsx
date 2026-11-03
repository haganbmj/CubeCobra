import React from 'react';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import '@testing-library/jest-dom';

import { P1P1Pack, P1P1VoteSummary } from '@utils/datatypes/P1P1Pack';

// `components/Markdown` pulls in react-syntax-highlighter for code blocks, which depends on the
// ESM-only refractor. Nothing under test here renders `Markdown`, but this is the stub every
// client test suite uses per `MarkdownPipeline.component.test.tsx:10-11`.
jest.mock('react-syntax-highlighter', () => ({ __esModule: true, default: () => null }));
jest.mock('react-syntax-highlighter/dist/cjs/styles/hljs', () => ({ a11yDark: {}, a11yLight: {} }));

// `P1P1PackDisplay` (reused unmodified by the modal) calls this hook directly, so every test here
// needs a deterministic stand-in rather than a real CSRF-backed fetch.
jest.mock('hooks/useP1P1Vote', () => ({ __esModule: true, default: jest.fn() }));

// `renderEmbed` exercises the tile -> modal wiring through the real `P1P1Embed`, which resolves
// its pack via this hook - stubbed here the same way `P1P1EmbedTile.component.test.tsx` stubs it,
// so assertions don't race an unresolved `fetch` (undefined in jsdom).
jest.mock('hooks/useP1P1Pack', () => ({ __esModule: true, default: jest.fn() }));

import P1P1Embed from 'components/markdown/P1P1Embed';
import P1P1EmbedModal from 'components/markdown/P1P1EmbedModal';
import UserContext from 'contexts/UserContext';
import useP1P1Pack from 'hooks/useP1P1Pack';
import useP1P1Vote from 'hooks/useP1P1Vote';

import { createUser } from '../../../server/test/test-utils/data';

const mockedUseP1P1Vote = useP1P1Vote as jest.Mock;
const mockedUseP1P1Pack = useP1P1Pack as jest.Mock;

const PACK_ID = '3e9d3a4e-1f1a-4e7d-9a3b-2d5f6a7c8b9d';

const card = (name: string) =>
  ({
    cardID: name,
    details: { name, image_normal: `https://example.com/${name}.jpg` },
  }) as any;

const pack = (overrides: Partial<P1P1Pack> = {}): P1P1Pack =>
  ({
    id: PACK_ID,
    createdBy: 'user-1',
    cubeId: 'cube-1',
    date: 1700000000000,
    votesByUser: {},
    cards: [card('Sol Ring'), card('Mana Crypt'), card('Lightning Bolt'), card('Force of Will')],
    createdByUsername: 'dekkerglen',
    seed: 'seed',
    source: 'random',
    ...overrides,
  }) as P1P1Pack;

const votes = (overrides: Partial<P1P1VoteSummary> = {}): P1P1VoteSummary => ({
  totalVotes: 42,
  results: [],
  ...overrides,
});

const defaultCube = { name: 'Vintage Cube', shortId: 'vintage' };

const voteMock = jest.fn();

beforeEach(() => {
  voteMock.mockReset();
  voteMock.mockResolvedValue(votes({ userVote: 0, totalVotes: 1 }));
  mockedUseP1P1Vote.mockReturnValue({ voting: false, error: null, submitVote: voteMock });
});

interface RenderOpenModalOverrides {
  pack?: P1P1Pack;
  votes?: P1P1VoteSummary;
  cube?: { name: string; shortId: string };
  caption?: string;
  user?: ReturnType<typeof createUser> | null;
  onVoteUpdate?: (votes: P1P1VoteSummary) => void;
}

const renderOpenModal = (overrides: RenderOpenModalOverrides) =>
  render(
    <UserContext.Provider value={overrides.user === null ? null : (overrides.user ?? createUser({ id: 'user-1' }))}>
      <P1P1EmbedModal
        pack={overrides.pack ?? pack()}
        votes={overrides.votes ?? votes()}
        cube={overrides.cube ?? defaultCube}
        caption={overrides.caption}
        isOpen
        setOpen={jest.fn()}
        onVoteUpdate={overrides.onVoteUpdate ?? jest.fn()}
      />
    </UserContext.Provider>,
  );

interface RenderEmbedOverrides {
  pack?: P1P1Pack;
  votes?: P1P1VoteSummary;
  cube?: { name: string; shortId: string };
  user?: ReturnType<typeof createUser> | null;
}

const renderEmbed = (overrides: RenderEmbedOverrides = {}) => {
  mockedUseP1P1Pack.mockReturnValue({
    pack: overrides.pack ?? pack(),
    votes: overrides.votes ?? votes(),
    cube: overrides.cube ?? defaultCube,
    loading: false,
    error: null,
    refetch: jest.fn(),
  });
  return render(
    <UserContext.Provider value={overrides.user === null ? null : (overrides.user ?? createUser({ id: 'user-1' }))}>
      <P1P1Embed id={PACK_ID} />
    </UserContext.Provider>,
  );
};

describe('P1P1EmbedModal', () => {
  it('votes through the existing endpoint', async () => {
    renderOpenModal({ votes: votes({ totalVotes: 1, userVote: undefined }) });
    fireEvent.click(screen.getAllByRole('img')[2]);
    await waitFor(() => expect(voteMock).toHaveBeenCalledWith(PACK_ID, 2));
  });

  it('withholds results until the reader has voted', () => {
    renderOpenModal({ votes: votes({ userVote: undefined }) });
    expect(screen.queryByTestId('p1p1-results')).not.toBeInTheDocument();
  });

  it('shows results once the reader has voted', () => {
    renderOpenModal({ votes: votes({ userVote: 0 }) });
    expect(screen.getByTestId('p1p1-results')).toBeInTheDocument();
  });

  it('does not offer a vote to an anonymous reader', () => {
    renderOpenModal({ user: null });
    expect(screen.getByText(/log in/i)).toBeInTheDocument();
  });

  it('links to the pack and the cube', () => {
    renderOpenModal({});
    expect(screen.getByRole('link', { name: /pack/i })).toHaveAttribute('href', `/cube/p1p1/${PACK_ID}`);
    expect(screen.getByRole('link', { name: 'Vintage Cube' })).toHaveAttribute('href', '/cube/list/vintage');
  });
});

describe('P1P1Embed -> P1P1EmbedModal wiring', () => {
  it('opens when the tile is clicked', () => {
    renderEmbed();
    fireEvent.click(screen.getByTestId('p1p1-embed-tile'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('updates the tile call to action after voting in the modal', async () => {
    renderEmbed({ votes: votes({ userVote: undefined }) });
    fireEvent.click(screen.getByTestId('p1p1-embed-tile'));
    // The tile's own (non-interactive) card grid stays mounted behind the modal, so the vote must
    // target a card inside the dialog specifically, not just the first image on the page.
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('img')[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: /See results/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.getByRole('button', { name: /See results/ })).toBeInTheDocument();
  });
});
