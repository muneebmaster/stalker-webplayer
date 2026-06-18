import { useCallback, useState } from "react";
import type { Channel } from "../types";

const STORAGE_KEY = "stalker-webplayer:favourites";

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set<string>(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function save(favs: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...favs]));
}

// Favourites are keyed by channel number + name so that portals which list the
// same channel name more than once (each with its own number) are treated as
// distinct entries — starring one no longer stars its duplicates.
function channelKey(channel: Pick<Channel, "number" | "name">): string {
  return `${channel.number.trim()}|${channel.name.toLowerCase().trim()}`;
}

export function useFavourites() {
  const [favourites, setFavourites] = useState<Set<string>>(load);

  const toggleFavourite = useCallback((channel: Channel) => {
    setFavourites((prev) => {
      const key = channelKey(channel);
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      save(next);
      return next;
    });
  }, []);

  const isFavourite = useCallback(
    (channel: Pick<Channel, "number" | "name">) => favourites.has(channelKey(channel)),
    [favourites]
  );

  // Merge imported favourite keys into the existing set (union, no clobber).
  const importFavourites = useCallback((keys: string[]) => {
    setFavourites((prev) => {
      const next = new Set(prev);
      for (const key of keys) next.add(key);
      save(next);
      return next;
    });
  }, []);

  return { favourites, isFavourite, toggleFavourite, importFavourites };
}
