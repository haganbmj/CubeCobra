import React from 'react';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import '@testing-library/jest-dom';

import { EmbedBudgetContextProvider, MAX_PAGE_EMBEDS, useEmbedBudget } from 'contexts/EmbedBudgetContext';

import P1P1Embed from 'components/markdown/P1P1Embed';

const PACK_ID = '3e9d3a4e-1f1a-4e7d-9a3b-2d5f6a7c8b9d';
const OTHER_ID = '7c2b8f1a-4d5e-4a6b-8c9d-0e1f2a3b4c5d';

// jsdom has no `IntersectionObserver`. This stub tracks every observer it creates so a test can
// drive each one's callback directly - `triggerAll(true)` simulates every observed element
// scrolling near the viewport, and leaving it untriggered simulates nothing having scrolled yet.
class IntersectionObserverStub {
  static instances: IntersectionObserverStub[] = [];

  callback: IntersectionObserverCallback;

  target: Element | null = null;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    IntersectionObserverStub.instances.push(this);
  }

  observe(target: Element) {
    this.target = target;
  }

  unobserve() {}

  disconnect() {}

  trigger(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting, target: this.target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }

  static triggerAll(isIntersecting: boolean) {
    act(() => {
      IntersectionObserverStub.instances.forEach((instance) => instance.trigger(isIntersecting));
    });
  }
}

const packResponse = (id: string) => ({
  success: true,
  pack: {
    id,
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
});

let fetchMock: jest.Mock;

beforeEach(() => {
  IntersectionObserverStub.instances = [];
  (window as any).IntersectionObserver = IntersectionObserverStub;
  fetchMock = jest.fn((input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.url;
    const id = url.split('/').pop() as string;
    return Promise.resolve({ ok: true, json: async () => packResponse(id) });
  });
  global.fetch = fetchMock as any;
});

// A probe component so claim's answers are readable from the DOM - the same style the other
// context test suites in this directory use - rather than reaching into React internals.
const ClaimProbe: React.FC<{ keys: string[] }> = ({ keys }) => {
  const { claim } = useEmbedBudget();
  return (
    <>
      {keys.map((key, index) => (
        <span key={index} data-testid={`claim-${index}`}>
          {String(claim(key))}
        </span>
      ))}
    </>
  );
};

const renderClaims = (keys: string[], { max }: { max: number }): boolean[] => {
  render(
    <EmbedBudgetContextProvider max={max}>
      <ClaimProbe keys={keys} />
    </EmbedBudgetContextProvider>,
  );
  return keys.map((_, index) => screen.getByTestId(`claim-${index}`).textContent === 'true');
};

interface RenderEmbedsOptions {
  max: number;
  intersecting?: boolean;
}

// `useP1P1Pack`'s fetch resolves on a later microtask, outside the synchronous `render()`/
// `fireEvent` calls above - without this, its `setState` calls land after the test's `act()` scope
// has already closed and React warns that they are not wrapped in `act(...)`.
const flushPendingFetch = () => act(() => Promise.resolve());

const renderEmbeds = (ids: string[], { max, intersecting = true }: RenderEmbedsOptions) => {
  const result = render(
    <EmbedBudgetContextProvider max={max}>
      {ids.map((id, index) => (
        <P1P1Embed key={index} id={id} />
      ))}
    </EmbedBudgetContextProvider>,
  );
  if (intersecting) {
    IntersectionObserverStub.triggerAll(true);
  }
  return result;
};

describe('EmbedBudgetContext claim', () => {
  it('grants slots up to the ceiling and refuses the rest', () => {
    expect(renderClaims(['a', 'b', 'c'], { max: 2 })).toEqual([true, true, false]);
  });

  it('treats a repeated key as the same slot', () => {
    expect(renderClaims(['a', 'a', 'b'], { max: 2 })).toEqual([true, true, true]);
  });

  it('defaults to MAX_PAGE_EMBEDS when no max is given', () => {
    const keys = Array.from({ length: MAX_PAGE_EMBEDS + 1 }, (_, i) => `k${i}`);
    render(
      <EmbedBudgetContextProvider>
        <ClaimProbe keys={keys} />
      </EmbedBudgetContextProvider>,
    );
    expect(screen.getByTestId(`claim-${MAX_PAGE_EMBEDS - 1}`)).toHaveTextContent('true');
    expect(screen.getByTestId(`claim-${MAX_PAGE_EMBEDS}`)).toHaveTextContent('false');
  });
});

describe('P1P1Embed budget gating', () => {
  it('shows Load This instead of fetching when over budget', async () => {
    renderEmbeds([PACK_ID, OTHER_ID], { max: 1 });
    await flushPendingFetch();
    expect(screen.getAllByRole('button', { name: /Load This/ })).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches once for the same pack embedded twice, and both render the resolved tile', async () => {
    renderEmbeds([PACK_ID, PACK_ID], { max: 5 });
    // `findAllBy` resolves as soon as the query returns anything non-empty, which happens as soon
    // as the owning embed's tile renders - before the duplicate has necessarily received the
    // owner's published result. `waitFor` instead keeps polling until the full assertion holds.
    await waitFor(() => {
      expect(screen.getAllByTestId('p1p1-embed-tile')).toHaveLength(2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders the unresolvable fallback for both embeds, not one tile and one error, when the shared fetch fails', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, json: async () => ({ error: 'P1P1 pack not found' }) }),
    );
    renderEmbeds([PACK_ID, PACK_ID], { max: 5 });
    await waitFor(() => {
      const embeds = screen.getAllByTestId('p1p1-embed');
      embeds.forEach((embed) => expect(embed).toHaveTextContent(`[[p1p1:${PACK_ID}]]`));
    });
    expect(screen.queryAllByTestId('p1p1-embed-tile')).toHaveLength(0);
    expect(screen.getAllByTestId('p1p1-embed')).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fetch until the tile nears the viewport', async () => {
    renderEmbeds([PACK_ID], { max: 5, intersecting: false });
    await flushPendingFetch();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches after Load This is clicked', async () => {
    renderEmbeds([PACK_ID, OTHER_ID], { max: 1 });
    await flushPendingFetch();
    fireEvent.click(screen.getByRole('button', { name: /Load This/ }));
    await flushPendingFetch();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
