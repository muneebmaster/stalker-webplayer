import { useCallback, useRef, useState } from "react";
import { getEpg } from "../api";
import type { EpgProgram } from "../types";

/**
 * Lazily fetches and caches short-EPG data per channel, keyed by channel id.
 * `ensureLoaded` is safe to call repeatedly (e.g. from an IntersectionObserver)
 * — it only fetches once per channel.
 */
export function useEpgCache(sessionId: string | null) {
  const cacheRef = useRef<Record<string, EpgProgram[]>>({});
  const pending = useRef(new Set<string>());
  const [, forceRender] = useState(0);

  const ensureLoaded = useCallback(
    (channelId: string) => {
      if (!sessionId) return;
      if (cacheRef.current[channelId] || pending.current.has(channelId)) return;
      pending.current.add(channelId);

      getEpg(sessionId, channelId)
        .then((programs) => {
          cacheRef.current = { ...cacheRef.current, [channelId]: programs };
          forceRender((v) => v + 1);
        })
        .catch(() => {
          cacheRef.current = { ...cacheRef.current, [channelId]: [] };
          forceRender((v) => v + 1);
        })
        .finally(() => {
          pending.current.delete(channelId);
        });
    },
    [sessionId]
  );

  return { cache: cacheRef.current, ensureLoaded };
}

export function findCurrentProgram(programs: EpgProgram[] | undefined, now: number): EpgProgram | null {
  if (!programs) return null;
  return programs.find((p) => p.startTimestamp <= now && now < p.stopTimestamp) ?? null;
}

export function findNextProgram(programs: EpgProgram[] | undefined, now: number): EpgProgram | null {
  if (!programs) return null;
  return programs.find((p) => p.startTimestamp > now) ?? null;
}
