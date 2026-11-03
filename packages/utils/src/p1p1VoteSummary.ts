import { P1P1Pack, P1P1VoteResult, P1P1VoteSummary } from './datatypes/P1P1Pack';

/**
 * The vote state of a pack, as it can be derived from the pack's DynamoDB record alone - no cards,
 * so no way to know how many there are.
 *
 * `counts` is sparse: only card indices that actually received a vote appear.
 */
export interface P1P1VoteCounts {
  totalVotes: number;
  counts: Record<number, number>;
  userVote?: number;
}

/**
 * Expands sparse vote counts into the full `P1P1VoteSummary` the UI consumes, using the pack for
 * the two things counts alone cannot supply: how many cards to produce a result for, and the bot's
 * pick and weights.
 *
 * Shared deliberately. The server reaches it with a freshly-read pack (`getVoteSummary`), and the
 * client reaches it with a pack from its IndexedDB cache plus counts from the votes-only route.
 * Those are the two halves of the same answer, and a copy on either side would drift the moment one
 * changed - so neither side owns this.
 */
export const buildVoteSummary = (
  votes: P1P1VoteCounts,
  pack: Pick<P1P1Pack, 'cards' | 'botPick' | 'botWeights'>,
): P1P1VoteSummary => {
  const { totalVotes, counts, userVote } = votes;

  const results: P1P1VoteResult[] = Array.from({ length: pack.cards.length }, (_, index) => ({
    cardIndex: index,
    voteCount: counts[index] || 0,
    // Divided by the human total: the bot's pick is displayed as an extra vote but never dilutes
    // the shares the voters actually cast.
    percentage: totalVotes > 0 ? ((counts[index] || 0) / totalVotes) * 100 : 0,
  }));

  return {
    totalVotes,
    results,
    userVote,
    botPick: pack.botPick,
    botWeights: pack.botWeights,
  };
};
