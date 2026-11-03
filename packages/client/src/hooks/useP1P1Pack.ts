import { useEffect, useState } from 'react';

import { P1P1Pack, P1P1VoteSummary } from '@utils/datatypes/P1P1Pack';
import { buildVoteSummary } from '@utils/p1p1VoteSummary';

import { readPack, writePack } from 'utils/p1p1PackCache';

interface UseP1P1PackResult {
  pack: P1P1Pack | null;
  votes: P1P1VoteSummary | null;
  cube: { name: string; shortId: string } | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const useP1P1Pack = (packId: string | null): UseP1P1PackResult => {
  const [pack, setPack] = useState<P1P1Pack | null>(null);
  const [votes, setVotes] = useState<P1P1VoteSummary | null>(null);
  const [cube, setCube] = useState<{ name: string; shortId: string } | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPack = async () => {
    if (!packId) return;

    setLoading(true);
    setError(null);

    try {
      // The cache read comes FIRST and is awaited, which is what decides the endpoint. An earlier
      // version deliberately fired the request before touching IndexedDB so the network was never
      // delayed behind local I/O - that ordering cannot survive here, because choosing the cheap
      // endpoint requires already knowing whether we hold the body. The trade is one local
      // IndexedDB read ahead of the request, in exchange for the server skipping an S3 read
      // entirely. Please don't "restore" the old ordering: it silently disables the cheap path.
      const cached = await readPack(packId);

      if (cached) {
        // The pack body is immutable, so only the vote state needs refreshing. `/p1p1votes` answers
        // from the pack's DynamoDB record alone, and returns sparse counts because it has no card
        // list to size them against - they are expanded here against the cards we already hold.
        const response = await fetch(`/tool/api/p1p1votes/${packId}`);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to fetch P1P1 votes');
        }

        const data = await response.json();

        setPack(cached);
        setVotes(buildVoteSummary(data.votes, cached));
        setCube(data.cube);
        return;
      }

      const response = await fetch(`/tool/api/getp1p1/${packId}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch P1P1 pack');
      }

      const data = await response.json();

      setPack(data.pack);
      writePack(packId, data.pack);
      setVotes(data.votes);
      setCube(data.cube);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      setPack(null);
      setVotes(null);
      setCube(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId]);

  return {
    pack,
    votes,
    cube,
    loading,
    error,
    refetch: fetchPack,
  };
};

export default useP1P1Pack;
