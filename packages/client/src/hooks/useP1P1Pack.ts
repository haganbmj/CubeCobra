import { useEffect, useState } from 'react';

import { P1P1Pack, P1P1VoteSummary } from '@utils/datatypes/P1P1Pack';

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

    // Started alongside the network fetch, not awaited before it - keeping `fetch` the first (and
    // only) await in this function's own control flow avoids delaying the request behind a local
    // IndexedDB read. This doesn't save the request itself: `votes` (and `cube`) always have to
    // come from the network regardless of a cache hit, since `getp1p1` is the only endpoint and
    // `p1p1PackCache.ts` never caches vote state, so the server still does its usual DynamoDB get
    // plus S3 read either way. What a hit buys is purely client-side: the pack body can paint
    // immediately from IndexedDB instead of waiting on this response to settle.
    let cacheHit = false;
    readPack(packId).then((cached) => {
      if (!cached) return;
      cacheHit = true;
      setPack(cached);
    });

    try {
      const response = await fetch(`/tool/api/getp1p1/${packId}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch P1P1 pack');
      }

      const data = await response.json();

      if (!cacheHit) {
        setPack(data.pack);
        writePack(packId, data.pack);
      }
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
