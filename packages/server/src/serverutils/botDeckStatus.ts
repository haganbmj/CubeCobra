/**
 * Read-side resolution of a draft's bot-deck build state.
 *
 * `botDecksPending` is cleared by whoever finishes the build, so anything that kills the
 * bot-deckbuild Lambda before its handler can react — a timeout, an OOM, an uncaught throw —
 * sends the SQS message to the DLQ without ever marking the draft failed, and the draft sits
 * "building…" forever. Rather than trusting the flag alone, treat a build that hasn't reported
 * back well past its retry envelope as failed: the bot seats keep their naive layout, which is
 * exactly what a terminal failure looks like anyway.
 */

// The queue gives a build 30 minutes of visibility timeout and up to 3 receives before the DLQ,
// so nothing legitimately in flight is older than ~90 minutes.
export const BOT_DECK_BUILD_STALE_MS = 90 * 60 * 1000;

export interface BotDeckStatus {
  pending: boolean;
  failed: boolean;
}

export interface BotDeckStatusSource {
  botDecksPending?: boolean;
  botDecksFailed?: boolean;
  botDecksPendingSince?: number;
  dateLastUpdated?: number;
  date?: number | Date;
}

export const resolveBotDeckStatus = (draft: BotDeckStatusSource, now: number = Date.now()): BotDeckStatus => {
  if (draft.botDecksFailed) {
    return { pending: false, failed: true };
  }
  if (!draft.botDecksPending) {
    return { pending: false, failed: false };
  }

  // Drafts from before botDecksPendingSince existed fall back to their timestamps. Both are
  // only ever >= the moment the build was enqueued, so the check stays conservative.
  const rawSince = draft.botDecksPendingSince ?? draft.dateLastUpdated ?? draft.date;
  const since = rawSince instanceof Date ? rawSince.valueOf() : rawSince;

  if (typeof since === 'number' && now - since > BOT_DECK_BUILD_STALE_MS) {
    return { pending: false, failed: true };
  }

  return { pending: true, failed: false };
};
