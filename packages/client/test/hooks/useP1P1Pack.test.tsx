import React from 'react';

import { P1P1Pack } from '@utils/datatypes/P1P1Pack';
import { render, screen, waitFor } from '@testing-library/react';

import '@testing-library/jest-dom';

// jsdom doesn't forward Node's `structuredClone` into its realm, and fake-indexeddb needs it to
// clone values on write. A JSON round-trip is a faithful enough clone for this plain pack data.
const globalWithClone = globalThis as unknown as { structuredClone?: (value: unknown) => unknown };
if (typeof globalWithClone.structuredClone === 'undefined') {
  globalWithClone.structuredClone = (value: unknown) => JSON.parse(JSON.stringify(value));
}

import 'fake-indexeddb/auto';

import useP1P1Pack from 'hooks/useP1P1Pack';
import { readPack, writePack } from 'utils/p1p1PackCache';

// Every test gets its own pack id so they can share one IndexedDB connection without interfering.
// Deleting the database between tests would block forever on the cache module's open singleton
// connection, which leaves an open handle and stops jest exiting.
const packId = (n: number) => `1111111${n}-1111-4111-8111-111111111111`;

const makePack = (id: string, overrides?: Partial<P1P1Pack>): P1P1Pack => ({
  id,
  createdBy: 'user-1',
  cubeId: 'cube-1',
  date: 1700000000000,
  votesByUser: {},
  cards: [{ name: 'Card A' } as any, { name: 'Card B' } as any],
  createdByUsername: 'dekkerglen',
  seed: 'seed',
  botPick: 1,
  botWeights: [0.3, 0.7],
  ...overrides,
});

const Harness: React.FC<{ id: string }> = ({ id }) => {
  const { pack, votes, cube, error } = useP1P1Pack(id);
  return (
    <div>
      <span data-testid="error">{error ?? ''}</span>
      <span data-testid="pack">{pack?.id ?? ''}</span>
      <span data-testid="cube">{cube?.name ?? ''}</span>
      <span data-testid="votes">{votes ? JSON.stringify(votes) : ''}</span>
    </div>
  );
};

const fetchMock = jest.fn();

const fullResponse = (pack: P1P1Pack) => ({
  ok: true,
  json: async () => ({
    success: true,
    pack,
    votes: {
      totalVotes: 1,
      results: [
        { cardIndex: 0, voteCount: 1, percentage: 100 },
        { cardIndex: 1, voteCount: 0, percentage: 0 },
      ],
      userVote: 0,
      botPick: 1,
      botWeights: [0.3, 0.7],
    },
    cube: { id: 'cube-uuid', name: 'Vintage Cube', shortId: 'vintage' },
  }),
});

const votesOnlyResponse = () => ({
  ok: true,
  json: async () => ({
    success: true,
    votes: { totalVotes: 1, counts: { 0: 1 }, userVote: 0 },
    cube: { id: 'cube-uuid', name: 'Vintage Cube', shortId: 'vintage' },
  }),
});

describe('useP1P1Pack', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = fetchMock;
  });

  it('calls only the votes-only endpoint when the body is cached', async () => {
    const id = packId(1);
    await writePack(id, makePack(id));
    fetchMock.mockResolvedValue(votesOnlyResponse());

    render(<Harness id={id} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toEqual(`/tool/api/p1p1votes/${id}`);
    await waitFor(() => expect(screen.getByTestId('cube')).toHaveTextContent('Vintage Cube'));
    expect(screen.getByTestId('pack')).toHaveTextContent(id);
  });

  it('calls the full endpoint and caches the body on a miss', async () => {
    const id = packId(2);
    fetchMock.mockResolvedValue(fullResponse(makePack(id)));

    render(<Harness id={id} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toEqual(`/tool/api/getp1p1/${id}`);
    await waitFor(async () => expect(await readPack(id)).not.toBeNull());
  });

  // The correctness argument for splitting the read in two: a reader must not be able to tell
  // which path served them.
  it('produces the same votes from either path', async () => {
    const networkId = packId(3);
    fetchMock.mockResolvedValue(fullResponse(makePack(networkId)));
    const first = render(<Harness id={networkId} />);
    await waitFor(() => expect(screen.getByTestId('votes')).not.toHaveTextContent(''));
    const fromNetwork = screen.getByTestId('votes').textContent;
    first.unmount();

    const cachedId = packId(4);
    await writePack(cachedId, makePack(cachedId));
    fetchMock.mockResolvedValue(votesOnlyResponse());
    render(<Harness id={cachedId} />);
    await waitFor(() => expect(screen.getByTestId('votes')).not.toHaveTextContent(''));

    expect(screen.getByTestId('votes').textContent).toEqual(fromNetwork);
  });

  it('surfaces a votes-only failure as an error, not a half-rendered tile', async () => {
    const id = packId(6);
    await writePack(id, makePack(id));
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'P1P1 pack not found' }) });

    render(<Harness id={id} />);

    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('P1P1 pack not found'));
    expect(screen.getByTestId('pack')).toHaveTextContent('');
  });
});
