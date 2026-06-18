import { useCallback, useState } from "react";

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

// Favourites are keyed by channel name (lower-cased) so they work across
// profiles where the same channel may have a different portal-specific ID.
function channelKey(name: string): string {
  return name.toLowerCase().trim();
}

export function useFavourites() {
  const [favourites, setFavourites] = useState<Set<string>>(load);

  const toggleFavourite = useCallback((channelName: string) => {
    setFavourites((prev) => {
      const key = channelKey(channelName);
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
    (channelName: string) => favourites.has(channelKey(channelName)),
    [favourites]
  );

  return { favourites, isFavourite, toggleFavourite };
}
