import type { Channel, Genre } from "../types";

export const ALL_GENRE_ID = "*";
export const FAVOURITES_GENRE_ID = "__favourites__";

interface Props {
  /** Genre/category list. In live mode these are live genres; in VOD/series mode these are media categories. */
  categories: Genre[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** If provided, shows channel counts next to each genre (live mode). */
  channels?: Channel[];
  /** If true, shows a "Favourites" entry at the top (live mode only). */
  showFavourites?: boolean;
  favouriteCount?: number;
}

export default function GenreSidebar({
  categories,
  selectedId,
  onSelect,
  channels,
  showFavourites,
  favouriteCount,
}: Props) {
  const counts = new Map<string, number>();
  if (channels) {
    for (const channel of channels) {
      counts.set(channel.genreId, (counts.get(channel.genreId) ?? 0) + 1);
    }
  }

  return (
    <div className="genre-sidebar">
      <div className="genre-sidebar-title">Categories</div>

      {showFavourites && (
        <button
          className={`genre-sidebar-item${selectedId === FAVOURITES_GENRE_ID ? " active" : ""}`}
          onClick={() => onSelect(FAVOURITES_GENRE_ID)}
        >
          <span>★ Favourites</span>
          <span className="genre-count">{favouriteCount ?? 0}</span>
        </button>
      )}

      <button
        className={`genre-sidebar-item${selectedId === ALL_GENRE_ID ? " active" : ""}`}
        onClick={() => onSelect(ALL_GENRE_ID)}
      >
        <span>All</span>
        {channels && <span className="genre-count">{channels.length}</span>}
      </button>

      {categories.filter((cat) => cat.id !== ALL_GENRE_ID).map((cat) => (
        <button
          key={cat.id}
          className={`genre-sidebar-item${selectedId === cat.id ? " active" : ""}`}
          onClick={() => onSelect(cat.id)}
        >
          <span>{cat.title}</span>
          {channels && <span className="genre-count">{counts.get(cat.id) ?? 0}</span>}
        </button>
      ))}
    </div>
  );
}
