import { countVotes } from 'dynamo/dao/P1P1PackDynamoDao';
import { cubeDao, p1p1PackDao } from 'dynamo/daos';
import Joi from 'joi';
import { isCubeViewable } from 'serverutils/cubefn';

import { NextFunction, Request, Response } from '../../../../types/express';

const ParamsSchema = Joi.object({
  packId: Joi.string().uuid().required().messages({
    'string.guid': 'Invalid pack ID format',
    'any.required': 'Pack ID is required',
  }),
});

export const validateParams = (req: Request, res: Response, next: NextFunction) => {
  const { error } = ParamsSchema.validate(req.params);
  if (error) {
    return res.status(400).json({ error: error.details?.[0]?.message || 'Validation error' });
  }
  return next();
};

/**
 * The cheap half of `getp1p1`: everything here comes from the pack's DynamoDB record, so this route
 * never touches S3. It is meant for a caller that already holds the pack body - the embed's
 * IndexedDB cache - and only needs the mutable vote state refreshed.
 *
 * `counts` is sparse because the handler cannot know the pack size without the S3 body. The caller
 * expands it against the card count it already has; a client-supplied length is never accepted.
 */
export const getP1P1VotesHandler = async (req: Request, res: Response) => {
  try {
    const { packId } = req.params;
    const { user } = req;

    if (!packId) {
      return res.status(400).json({ error: 'Pack ID is required' });
    }

    const pack = await p1p1PackDao.getMetadataById(packId);
    if (!pack) {
      return res.status(404).json({ error: 'P1P1 pack not found' });
    }

    // A pack is only as visible as the cube it was generated from. This 404 is deliberately
    // byte-identical to the missing-pack one above, so it cannot be used to probe whether a
    // private cube's pack exists.
    const cube = await cubeDao.getById(pack.cubeId);
    if (!cube || !isCubeViewable(cube, user)) {
      return res.status(404).json({ error: 'P1P1 pack not found' });
    }

    return res.status(200).json({
      success: true,
      votes: countVotes(pack.votesByUser, user?.id),
      cube: { id: cube.id, name: cube.name, shortId: cube.shortId },
    });
  } catch (err) {
    const error = err as Error;
    req.logger.error(error.message, error.stack);
    return res.status(500).json({ error: 'Error fetching P1P1 votes' });
  }
};

export const routes = [
  {
    method: 'get',
    path: '/:packId',
    handler: [validateParams, getP1P1VotesHandler],
  },
];
