import { P1P1Pack } from '@utils/datatypes/P1P1Pack';
import { buildVoteSummary } from '@utils/p1p1VoteSummary';

const packOf = (cardCount: number, overrides?: Partial<P1P1Pack>): P1P1Pack =>
  ({
    id: 'pack-1',
    cubeId: 'cube-1',
    createdBy: 'user-1',
    createdByUsername: 'user-one',
    date: 0,
    seed: 'seed',
    votesByUser: {},
    cards: Array.from({ length: cardCount }, (_, i) => ({ cardID: `card-${i}` })),
    ...overrides,
  }) as P1P1Pack;

describe('buildVoteSummary', () => {
  it('zero-fills counts to one result per card', () => {
    const summary = buildVoteSummary({ totalVotes: 3, counts: { 0: 1, 2: 2 } }, packOf(4));

    expect(summary.results).toEqual([
      { cardIndex: 0, voteCount: 1, percentage: (1 / 3) * 100 },
      { cardIndex: 1, voteCount: 0, percentage: 0 },
      { cardIndex: 2, voteCount: 2, percentage: (2 / 3) * 100 },
      { cardIndex: 3, voteCount: 0, percentage: 0 },
    ]);
  });

  it('reports the total it was given', () => {
    expect(buildVoteSummary({ totalVotes: 3, counts: { 0: 3 } }, packOf(2)).totalVotes).toEqual(3);
  });

  it('carries bot data through from the cached pack', () => {
    const summary = buildVoteSummary({ totalVotes: 0, counts: {} }, packOf(2, { botPick: 1, botWeights: [0.2, 0.8] }));

    expect(summary.botPick).toEqual(1);
    expect(summary.botWeights).toEqual([0.2, 0.8]);
  });

  it('gives every card zero percent when nobody has voted', () => {
    const summary = buildVoteSummary({ totalVotes: 0, counts: {} }, packOf(2));

    expect(summary.results.every((result) => result.percentage === 0)).toEqual(true);
  });

  it('preserves an absent userVote', () => {
    expect(buildVoteSummary({ totalVotes: 1, counts: { 0: 1 } }, packOf(2)).userVote).toBeUndefined();
  });

  // 0 is a real card index, so an `||`-style fallback would turn "picked the first card" into
  // "has not voted" - which would re-prompt a reader who already voted.
  it('preserves userVote of 0, which is a real card index', () => {
    expect(buildVoteSummary({ totalVotes: 1, counts: { 0: 1 }, userVote: 0 }, packOf(2)).userVote).toEqual(0);
  });

  // A cached body can be older than the vote record it is merged with.
  it('ignores counts beyond the cached pack length without throwing', () => {
    const summary = buildVoteSummary({ totalVotes: 2, counts: { 0: 1, 9: 1 } }, packOf(2));

    expect(summary.results).toHaveLength(2);
    expect(summary.results[0].voteCount).toEqual(1);
  });

  // The bot's pick is shown as an extra vote by P1P1Results, but it must not dilute the
  // percentages - those divide by the human total alone, as the server has always done.
  it('divides percentages by the human total, not the bot-inclusive one', () => {
    const summary = buildVoteSummary({ totalVotes: 2, counts: { 0: 2 } }, packOf(2, { botPick: 1 }));

    expect(summary.results[0].percentage).toEqual(100);
  });
});
