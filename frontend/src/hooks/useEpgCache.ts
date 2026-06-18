import { useCallback, useRef, useState } from "react";
import { getEpg } from "../api";
import type { EpgProgram } from "../types";

const MIN_EPG_SIZE = 12;
const MAX_EPG_SIZE = 60;
// Rough average programme length, used only to size the fetch: to cover up to
// `neededUntil` we ask for enough programmes that they likely reach it.
const PROGRAM_ESTIMATE_MS = 25 * 60 * 1000;

function sizeForCoverage(neededUntil: number): number {
  const span = neededUntil - Date.now();
  if (span <= 0) return MIN_EPG_SIZE;
  return Math.min(MAX_EPG_SIZE, Math.max(MIN_EPG_SIZE, Math.ceil(span / PROGRAM_ESTIMATE_MS) + 4));
}

/**
 * Lazily fetches and caches short-EPG data per channel, keyed by channel id.
 * `ensureLoaded` is safe to call repeatedly (e.g. from an IntersectionObserver).
 *
 * Pass `neededUntil` (a timestamp the caller needs coverage up to) to top up a
 * channel whose cached programmes no longer reach far enough — e.g. as the EPG
 * grid's time window slides forward. This triggers a server refresh that
 * bypasses the freshness cache and merges in newer programmes. A per-channel
 * guard prevents refetching channels the portal has no further data for, until
 * the requested window actually advances past the last attempt.
 */
export function useEpgCache(sessionId: string | null) {
  const cacheRef = useRef<Record<string, EpgProgram[]>>({});
  const pending = useRef(new Set<string>());
  const coverageTried = useRef<Record<string, number>>({});
  const [, forceRender] = useState(0);

  const ensureLoaded = useCallback(
    (channelId: string, neededUntil = 0) => {
      if (!sessionId) return;
      if (pending.current.has(channelId)) return;

      const cached = cacheRef.current[channelId];
      let refresh = false;

      if (cached !== undefined) {
        // Already loaded; only refetch to extend coverage when asked.
        if (neededUntil <= 0) return;
        const coversUntil = cached.length ? cached[cached.length - 1].stopTimestamp : 0;
        if (coversUntil >= neededUntil) return;
        if ((coverageTried.current[channelId] ?? 0) >= neededUntil) return;
        refresh = true;
      }

      pending.current.add(channelId);
      if (neededUntil > 0) {
        coverageTried.current[channelId] = Math.max(coverageTried.current[channelId] ?? 0, neededUntil);
      }

      getEpg(sessionId, channelId, { refresh, limit: sizeForCoverage(neededUntil) })
        .then((programs) => {
          cacheRef.current = { ...cacheRef.current, [channelId]: programs };
          forceRender((v) => v + 1);
        })
        .catch(() => {
          // On a refresh failure keep whatever we already had; only cache an
          // empty result for a channel that has never loaded.
          if (cacheRef.current[channelId] === undefined) {
            cacheRef.current = { ...cacheRef.current, [channelId]: [] };
            forceRender((v) => v + 1);
          }
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
