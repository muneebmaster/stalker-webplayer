import { useCallback, useEffect, useMemo, useState } from "react";
import type { SeriesEpisode, SeriesItem, VodCategory } from "../types";
import { getSeriesEpisodes, getSeriesList } from "../api";
import { ALL_GENRE_ID } from "./GenreSidebar";

interface Props {
  sessionId: string;
  categories: VodCategory[];
  selectedCategoryId: string;
  searchQuery: string;
  onPlay: (episode: SeriesEpisode, seriesName: string) => void;
}

export default function SeriesBrowser({ sessionId, categories: _categories, selectedCategoryId, searchQuery, onPlay }: Props) {
  const [items, setItems] = useState<SeriesItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SeriesItem | null>(null);
  const [activeSeason, setActiveSeason] = useState<number | null>(null);
  const [episodesLoading, setEpisodesLoading] = useState(false);

  const fetchPage = useCallback(
    async (catId: string, p: number, replace: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const result = await getSeriesList(sessionId, catId === ALL_GENRE_ID ? "*" : catId, p);
        setItems((prev) => (replace ? result.items : [...prev, ...result.items]));
        setTotalItems(result.totalItems);
        setPage(p);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    setItems([]);
    setSelected(null);
    setActiveSeason(null);
    fetchPage(selectedCategoryId, 1, true);
  }, [selectedCategoryId, fetchPage]);

  const handleSelectSeries = useCallback(async (s: SeriesItem) => {
    let target = s;

    // Most portals don't embed episodes in the list response. Fetch on demand.
    if (s.episodes.length === 0) {
      setEpisodesLoading(true);
      try {
        const eps = await getSeriesEpisodes(sessionId, s.id);
        if (eps.length > 0) {
          target = { ...s, episodes: eps };
          // Update cached item so subsequent clicks are instant.
          setItems((prev) => prev.map((item) => item.id === s.id ? target : item));
        }
      } catch {
        // Show series panel anyway even if episode fetch fails
      } finally {
        setEpisodesLoading(false);
      }
    }

    const seasons = [...new Set(target.episodes.map((e) => e.season))].sort((a, b) => a - b);
    setSelected(target);
    setActiveSeason(seasons[0] ?? null);
  }, [sessionId]);

  const seasons = useMemo(() => {
    if (!selected) return [];
    return [...new Set(selected.episodes.map((e) => e.season))].sort((a, b) => a - b);
  }, [selected]);

  const episodesForSeason = useMemo(() => {
    if (!selected || activeSeason === null) return [];
    return selected.episodes
      .filter((e) => e.season === activeSeason)
      .sort((a, b) => a.episode - b.episode);
  }, [selected, activeSeason]);

  const filtered = searchQuery.trim()
    ? items.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : items;

  const hasMore = items.length < totalItems;

  return (
    <div className="vod-browser">
      {selected && (
        <div className="vod-detail">
          <div className="vod-detail-poster">
            {selected.screenshot ? (
              <img src={selected.screenshot} alt={selected.name} />
            ) : (
              <div className="vod-poster-placeholder">{selected.name.slice(0, 2).toUpperCase()}</div>
            )}
          </div>
          <div className="vod-detail-info">
            <div className="vod-detail-title">{selected.name}</div>
            <div className="vod-detail-meta">
              {[selected.year, seasons.length > 0 ? `${seasons.length} season${seasons.length !== 1 ? "s" : ""}` : null]
                .filter(Boolean).join(" · ")}
            </div>
            {selected.description && <div className="vod-detail-desc">{selected.description}</div>}

            {episodesLoading && <div className="vod-loading" style={{ padding: "8px 0" }}>Loading episodes…</div>}

            {!episodesLoading && seasons.length > 0 && (
              <div className="series-seasons">
                {seasons.map((s) => (
                  <button
                    key={s}
                    className={`series-season-btn${activeSeason === s ? " active" : ""}`}
                    onClick={() => setActiveSeason(s)}
                  >
                    S{s}
                  </button>
                ))}
              </div>
            )}

            {!episodesLoading && (
              <div className="episode-list">
                {episodesForSeason.map((ep) => (
                  <button
                    key={ep.id}
                    className="episode-item"
                    onClick={() => onPlay(ep, selected.name)}
                  >
                    <span className="episode-num">E{ep.episode}</span>
                    <span className="episode-name">{ep.name || `Episode ${ep.episode}`}</span>
                    <span className="episode-play">▶</span>
                  </button>
                ))}
                {episodesForSeason.length === 0 && seasons.length === 0 && (
                  <div className="episode-empty">No episode data available for this series.</div>
                )}
              </div>
            )}
          </div>
          <button className="vod-detail-close" onClick={() => setSelected(null)} aria-label="Close">×</button>
        </div>
      )}

      {error && <div className="vod-error">{error}</div>}

      {!loading && !error && filtered.length === 0 ? (
        <div className="vod-empty">
          {searchQuery ? "No results match your search." : "No series in this category."}
        </div>
      ) : (
        <div className="vod-grid">
          {filtered.map((item) => (
            <div
              key={item.id}
              className={`vod-card${selected?.id === item.id ? " selected" : ""}`}
              onClick={() => handleSelectSeries(item)}
            >
              {item.screenshot ? (
                <img className="vod-card-poster" src={item.screenshot} alt={item.name} loading="lazy" />
              ) : (
                <div className="vod-card-poster vod-poster-placeholder">{item.name.slice(0, 2).toUpperCase()}</div>
              )}
              <div className="vod-card-info">
                <div className="vod-card-title">{item.name}</div>
                <div className="vod-card-meta">{item.year}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && <div className="vod-loading">Loading…</div>}

      {!loading && hasMore && !searchQuery && (
        <div className="vod-load-more-wrap">
          <button className="vod-load-more" onClick={() => fetchPage(selectedCategoryId, page + 1, false)}>
            Load more ({items.length} / {totalItems})
          </button>
        </div>
      )}
    </div>
  );
}
