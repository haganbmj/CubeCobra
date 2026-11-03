import { UnhydratedP1P1Pack } from '../../../src/dynamo/dao/P1P1PackDynamoDao';
import { getP1P1VotesHandler } from '../../../src/router/routes/tool/api/p1p1votes';
import { createCube, createUser } from '../../test-utils/data';
import { call } from '../../test-utils/transport';

const uuid = jest.requireActual('uuid');

jest.mock('../../../src/dynamo/daos', () => ({
  ...jest.requireActual('../../../src/dynamo/daos'),
  p1p1PackDao: {
    getById: jest.fn(),
    getMetadataById: jest.fn(),
  },
  cubeDao: {
    getById: jest.fn(),
  },
}));

import { cubeDao, p1p1PackDao } from '../../../src/dynamo/daos';

// `getMetadataById` returns the DynamoDB record only - no `cards`, no bot data, nothing from S3.
// Using the hydrated factory here would let a handler that secretly reached for S3 fields still pass.
const createUnhydratedP1P1Pack = (overrides?: Partial<UnhydratedP1P1Pack>): UnhydratedP1P1Pack => ({
  id: uuid.v4(),
  cubeId: uuid.v4(),
  createdBy: 'test-user',
  date: Date.now(),
  votesByUser: {},
  dateCreated: Date.now(),
  dateLastUpdated: Date.now(),
  ...overrides,
});

describe('P1P1 votes-only API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (cubeDao.getById as jest.Mock).mockResolvedValue(createCube());
    (p1p1PackDao.getMetadataById as jest.Mock).mockResolvedValue(createUnhydratedP1P1Pack());
  });

  it('returns sparse counts, total and the viewer vote', async () => {
    (p1p1PackDao.getMetadataById as jest.Mock).mockResolvedValue(
      createUnhydratedP1P1Pack({ votesByUser: { u1: 2, u2: 2, u3: 0 } }),
    );

    const res = await call(getP1P1VotesHandler)
      .as(createUser({ id: 'u3' }))
      .withParams({ packId: uuid.v4() })
      .send();

    expect(res.status).toEqual(200);
    expect(res.body.votes).toEqual({ totalVotes: 3, counts: { 0: 1, 2: 2 }, userVote: 0 });
  });

  it('omits userVote for an anonymous viewer', async () => {
    (p1p1PackDao.getMetadataById as jest.Mock).mockResolvedValue(createUnhydratedP1P1Pack({ votesByUser: { u1: 0 } }));

    const res = await call(getP1P1VotesHandler).withParams({ packId: uuid.v4() }).send();

    expect(res.body.votes.userVote).toBeUndefined();
  });

  it('returns empty counts for a pack with no votes', async () => {
    (p1p1PackDao.getMetadataById as jest.Mock).mockResolvedValue(createUnhydratedP1P1Pack({ votesByUser: {} }));

    const res = await call(getP1P1VotesHandler).withParams({ packId: uuid.v4() }).send();

    expect(res.body.votes).toEqual({ totalVotes: 0, counts: {} });
  });

  it('returns the cube name and shortId', async () => {
    (cubeDao.getById as jest.Mock).mockResolvedValue(createCube({ name: 'Vintage Cube', shortId: 'vintage' }));

    const res = await call(getP1P1VotesHandler).withParams({ packId: uuid.v4() }).send();

    expect(res.body.cube).toEqual({ name: 'Vintage Cube', shortId: 'vintage' });
  });

  it('never reads S3', async () => {
    await call(getP1P1VotesHandler).withParams({ packId: uuid.v4() }).send();

    expect(p1p1PackDao.getById).not.toHaveBeenCalled();
    expect(p1p1PackDao.getMetadataById).toHaveBeenCalled();
  });

  it.each([
    ['a missing pack', () => (p1p1PackDao.getMetadataById as jest.Mock).mockResolvedValue(undefined)],
    [
      'a pack whose cube is private',
      () => (cubeDao.getById as jest.Mock).mockResolvedValue(createCube({ visibility: 'pr' })),
    ],
  ])('404s identically for %s', async (_label, arrange) => {
    arrange();

    const res = await call(getP1P1VotesHandler)
      .as(createUser({ id: 'someone-else' }))
      .withParams({ packId: uuid.v4() })
      .send();

    expect(res.status).toEqual(404);
    expect(res.body).toEqual({ error: 'P1P1 pack not found' });
  });

  it('returns 500 when the lookup fails', async () => {
    (p1p1PackDao.getMetadataById as jest.Mock).mockRejectedValue(new Error('Database error'));

    const res = await call(getP1P1VotesHandler).withParams({ packId: uuid.v4() }).send();

    expect(res.status).toEqual(500);
    expect(res.body).toEqual({ error: 'Error fetching P1P1 votes' });
  });
});
