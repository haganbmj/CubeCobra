import { RefObject, useEffect, useState } from 'react';

// Starts the fetch while the tile is still a little off-screen, so by the time a reader actually
// scrolls it into view it is usually already resolved, rather than visibly popping in.
const ROOT_MARGIN = '200px';

/**
 * True once `ref`'s element has come within `ROOT_MARGIN` of the viewport. Sticky - once it flips
 * true it never reverts to false, even if the element later scrolls back out of view, so whatever
 * it gates (starting a fetch) runs exactly once instead of being torn down and retried on every
 * scroll in and out.
 *
 * jsdom (and any browser old enough to lack `IntersectionObserver`) has no implementation of it at
 * all, so this fails open there - true from the start - rather than permanently stranding every
 * embed on the page behind a budget check that can never run.
 */
const useNearViewport = (ref: RefObject<Element | null>): boolean => {
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    if (nearViewport) return;

    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
        }
      },
      { rootMargin: ROOT_MARGIN },
    );
    observer.observe(node);

    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.current, nearViewport]);

  return nearViewport;
};

export default useNearViewport;
