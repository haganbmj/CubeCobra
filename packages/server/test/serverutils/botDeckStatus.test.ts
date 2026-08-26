import { BOT_DECK_BUILD_STALE_MS, resolveBotDeckStatus } from 'serverutils/botDeckStatus';

describe('resolveBotDeckStatus', () => {
  const now = 1_700_000_000_000;

  it('reports nothing for a draft that never had a build', () => {
    expect(resolveBotDeckStatus({}, now)).toEqual({ pending: false, failed: false });
  });

  it('reports ready once the flag is cleared', () => {
    expect(resolveBotDeckStatus({ botDecksPending: false }, now)).toEqual({ pending: false, failed: false });
  });

  it('reports a build that is still in flight as pending', () => {
    const draft = { botDecksPending: true, botDecksPendingSince: now - 60_000 };
    expect(resolveBotDeckStatus(draft, now)).toEqual({ pending: true, failed: false });
  });

  it('reports an explicitly failed build as failed', () => {
    expect(resolveBotDeckStatus({ botDecksFailed: true }, now)).toEqual({ pending: false, failed: true });
  });

  // A Lambda timeout/crash reaches the DLQ without marking the draft failed, so the flag alone
  // would leave the banner spinning forever.
  it('gives up on a build that never reported back', () => {
    const draft = { botDecksPending: true, botDecksPendingSince: now - BOT_DECK_BUILD_STALE_MS - 1 };
    expect(resolveBotDeckStatus(draft, now)).toEqual({ pending: false, failed: true });
  });

  it('keeps waiting right up to the staleness cutoff', () => {
    const draft = { botDecksPending: true, botDecksPendingSince: now - BOT_DECK_BUILD_STALE_MS };
    expect(resolveBotDeckStatus(draft, now)).toEqual({ pending: true, failed: false });
  });

  it('falls back to the draft timestamps for drafts predating botDecksPendingSince', () => {
    const stale = { botDecksPending: true, dateLastUpdated: now - BOT_DECK_BUILD_STALE_MS - 1 };
    expect(resolveBotDeckStatus(stale, now)).toEqual({ pending: false, failed: true });

    const recent = { botDecksPending: true, date: now - 1000 };
    expect(resolveBotDeckStatus(recent, now)).toEqual({ pending: true, failed: false });
  });

  it('stays pending when there is no timestamp to judge by', () => {
    expect(resolveBotDeckStatus({ botDecksPending: true }, now)).toEqual({ pending: true, failed: false });
  });
});
