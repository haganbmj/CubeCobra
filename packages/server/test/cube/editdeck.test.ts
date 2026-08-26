import * as render from 'serverutils/render';

import { draftDao } from '../../src/dynamo/daos';
import { editDeckHandler } from '../../src/router/routes/cube/deck';
import { createCompletedSoloDraft, createUser } from '../test-utils/data';
import { call } from '../test-utils/transport';

jest.mock('../../src/dynamo/daos');
jest.mock('serverutils/carddb');
jest.mock('serverutils/render', () => ({
  handleRouteError: jest.fn(),
  redirect: jest.fn(),
}));

describe('Edit Deck Handler', () => {
  const flashMock = jest.fn();
  const owner = createUser();

  const draft = createCompletedSoloDraft({ owner });

  const validBody = {
    main: JSON.stringify([[[0, 1]]]),
    side: JSON.stringify([[[2]]]),
    title: '  My Deck  ',
    description: 'notes',
    seat: '0',
  };

  beforeEach(() => {
    (draftDao.getById as jest.Mock).mockResolvedValue(draft);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  const save = (body: any = validBody, user = owner) =>
    call(editDeckHandler).as(user).withFlash(flashMock).withParams({ id: draft.id }).withBody(body).send();

  it('saves the edited seat and redirects to the deck', async () => {
    await save();

    expect(draftDao.applySeatEdit).toHaveBeenCalledWith(draft.id, 0, {
      mainboard: [[[0, 1]]],
      sideboard: [[[2]]],
      title: 'My Deck',
      body: 'notes',
      newCards: [],
    });
    expect(render.redirect).toHaveBeenCalledWith(expect.anything(), expect.anything(), `/cube/deck/${draft.id}`);
  });

  // The regression this whole path exists for: saving used to persist the entire hydrated
  // draft, which reverted bot decks the async pipeline had written while the user was building
  // and re-set botDecksPending, leaving the draft "building…" forever.
  it('never writes the whole draft back', async () => {
    await save();

    expect(draftDao.update).not.toHaveBeenCalled();
  });

  it('passes newly added cards through so the DAO can extend the pool', async () => {
    const newCards = [{ cardID: 'new-card-id' }];
    await save({ ...validBody, newCards: JSON.stringify(newCards) });

    expect(draftDao.applySeatEdit).toHaveBeenCalledWith(draft.id, 0, expect.objectContaining({ newCards }));
  });

  it('truncates an over-long title and description', async () => {
    await save({ ...validBody, title: 'a'.repeat(150), description: 'b'.repeat(1500) });

    expect(draftDao.applySeatEdit).toHaveBeenCalledWith(
      draft.id,
      0,
      expect.objectContaining({ title: 'a'.repeat(100), body: 'b'.repeat(1000) }),
    );
  });

  it('rejects a save from someone who does not own the draft', async () => {
    const res = await save(validBody, createUser());

    expect(res.status).toBe(401);
    expect(draftDao.applySeatEdit).not.toHaveBeenCalled();
  });

  it('rejects a seat the draft does not have', async () => {
    await save({ ...validBody, seat: '7' });

    expect(draftDao.applySeatEdit).not.toHaveBeenCalled();
    expect(flashMock).toHaveBeenCalledWith('danger', 'Invalid seat');
  });
});
