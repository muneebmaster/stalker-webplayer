import { useEffect, useRef, useState } from "react";

// A row must stay on screen this long before it counts as visible, so rows
// scrolled past during a fast flick never trigger a portal request.
const DEFAULT_DWELL_MS = 300;

/**
 * Tracks whether an element is (and stays) near the viewport. Returns a ref to
 * attach and a `visible` flag. Channel/EPG lists render every row unvirtualized,
 * so callers use `visible` to fetch EPG only for rows actually on screen — and
 * to re-fetch as the visible time window changes — rather than firing a request
 * for every row the instant it mounts.
 */
export function useVisibilityEffect<T extends Element>(dwellMs = DEFAULT_DWELL_MS) {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries.some((entry) => entry.isIntersecting);
        if (intersecting) {
          if (timer == null) {
            timer = setTimeout(() => {
              timer = null;
              setVisible(true);
            }, dwellMs);
          }
        } else {
          if (timer != null) {
            clearTimeout(timer);
            timer = null;
          }
          setVisible(false);
        }
      },
      { rootMargin: "150px 0px" }
    );
    observer.observe(el);
    return () => {
      if (timer != null) clearTimeout(timer);
      observer.disconnect();
    };
  }, [dwellMs]);

  return { ref, visible };
}
