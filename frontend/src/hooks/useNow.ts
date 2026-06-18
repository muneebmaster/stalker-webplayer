import { useEffect, useState } from "react";

/** Returns the current time in ms, refreshed on an interval. */
export function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
