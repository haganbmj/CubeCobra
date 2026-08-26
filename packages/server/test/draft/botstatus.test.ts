jest.mock('../../src/dynamo/daos', () => ({
  draftDao: { getById: jest.fn() },
}));

import { draftDao } from '../../src/dynamo/daos';
import { handler } from '../../src/router/routes/draft/botstatus';
import { call } from '../test-utils/transport';

describe('GET /draft/botstatus/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when the id is missing', async () => {
    const res = await call(handler).withParams({}).send();
    expect(res.status).toBe(400);
  });

  it('returns 404 when the draft does not exist', async () => {
    (draftDao.getById as jest.Mock).mockResolvedValue(undefined);
    const res = await call(handler).withParams({ id: 'missing' }).send();
    expect(res.status).toBe(404);
  });

  it('reports pending: true while bot decks are building', async () => {
    (draftDao.getById as jest.Mock).mockResolvedValue({ id: 'd1', botDecksPending: true });
    const res = await call(handler).withParams({ id: 'd1' }).send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: true, failed: false });
  });

  it('reports failed: true when the build terminally failed', async () => {
    (draftDao.getById as jest.Mock).mockResolvedValue({ id: 'd1', botDecksPending: false, botDecksFailed: true });
    const res = await call(handler).withParams({ id: 'd1' }).send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: false, failed: true });
  });

  it('reports pending: false once bot decks are ready', async () => {
    (draftDao.getById as jest.Mock).mockResolvedValue({ id: 'd1', botDecksPending: false });
    const res = await call(handler).withParams({ id: 'd1' }).send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: false, failed: false });
  });

  it('reports a build that never reported back as failed rather than pending forever', async () => {
    // A Lambda timeout or crash goes to the DLQ without marking the draft failed, so the flag
    // alone would keep the client polling a build that is never coming back.
    (draftDao.getById as jest.Mock).mockResolvedValue({
      id: 'd1',
      botDecksPending: true,
      botDecksPendingSince: Date.now() - 3 * 60 * 60 * 1000,
    });
    const res = await call(handler).withParams({ id: 'd1' }).send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: false, failed: true });
  });

  it('treats a missing flag as not pending', async () => {
    (draftDao.getById as jest.Mock).mockResolvedValue({ id: 'd1' });
    const res = await call(handler).withParams({ id: 'd1' }).send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: false, failed: false });
  });
});
