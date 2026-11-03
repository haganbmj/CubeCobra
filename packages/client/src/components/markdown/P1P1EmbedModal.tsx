import React from 'react';

import { P1P1Pack, P1P1VoteSummary } from '@utils/datatypes/P1P1Pack';
import { getCubeId } from '@utils/Util';

import Button from '../base/Button';
import { Flexbox } from '../base/Layout';
import Link from '../base/Link';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../base/Modal';
import P1P1PackDisplay from '../p1p1/P1P1PackDisplay';
import P1P1Results from '../p1p1/P1P1Results';

export interface P1P1EmbedModalProps {
  pack: P1P1Pack;
  votes: P1P1VoteSummary;
  cube: { id: string; name: string; shortId: string };
  caption?: string;
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  onVoteUpdate: (votes: P1P1VoteSummary) => void;
}

/**
 * The detail view a `P1P1EmbedTile` expands into: the same pack, live and votable, instead of the
 * tile's static preview. Voting goes through the exact same pieces the full P1P1 page uses -
 * `P1P1PackDisplay` (which itself calls `useP1P1Vote`) - so there is no second voting
 * implementation to keep in sync with the first. Bot overlays stay off (`showBotWeights={false}`):
 * embeds never surface the bot's pick or its weights, in the modal any more than in the tile.
 *
 * Results are gated on `votes.userVote !== undefined`, matching `P1P1Page.tsx:133`, so a reader who
 * opens the modal without voting sees only the pack, not the outcome.
 *
 * `votes` is a prop, not local state: the embed above owns it (so it can keep the tile's call to
 * action in sync after the modal closes) and this component only ever relays `onVoteUpdate` back
 * up, exactly as `P1P1Page` relays it from `P1P1PackDisplay` into its own `currentVotes` state.
 */
const P1P1EmbedModal: React.FC<P1P1EmbedModalProps> = ({
  pack,
  votes,
  cube,
  caption,
  isOpen,
  setOpen,
  onVoteUpdate,
}) => {
  return (
    <Modal isOpen={isOpen} setOpen={setOpen} xxl scrollable>
      <ModalHeader setOpen={setOpen}>{caption ?? cube.name}</ModalHeader>
      <ModalBody scrollable>
        <Flexbox direction="col" gap="3">
          <Link href={`/cube/list/${getCubeId(cube)}`}>{cube.name}</Link>
          <P1P1PackDisplay pack={pack} votes={votes} showBotWeights={false} onVoteUpdate={onVoteUpdate} />
          {votes.userVote !== undefined && (
            <div data-testid="p1p1-results">
              <P1P1Results pack={pack} votes={votes} />
            </div>
          )}
          <Link href={`/cube/p1p1/${pack.id}`}>View the full pack page</Link>
        </Flexbox>
      </ModalBody>
      <ModalFooter>
        <Button color="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default P1P1EmbedModal;
