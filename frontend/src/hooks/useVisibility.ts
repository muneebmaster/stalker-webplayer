import { useEffect, useRef } from "react";

/**
 * Calls `onVisible` only once an element scrolls near the viewport, rather
 * than immediately on mount. Channel/EPG lists render every row unvirtualized,
 * so firing a per-row fetch on mount means thousands of concurrent requests
 * for large portals, exhausting the browser's connection pool.
 */
export function useVisibilityEffect<T extends Element>(onVisible: () => void) {
  const ref = useRef<T | null>(null);
  const callbackRef = useRef(onVisible);
  callbackRef.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      callbackRef.current();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          callbackRef.current();
        }
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return ref;
}
