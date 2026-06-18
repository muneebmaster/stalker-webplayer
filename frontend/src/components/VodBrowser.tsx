import { useCallback, useEffect, useState } from "react";
import type { VodCategory, VodItem } from "../types";
import { getVodList } from "../api";
import { ALL_GENRE_ID } from "./GenreSidebar";

interface Props {
  sessionId: string;
  categories: VodCategory[];
  selectedCategoryId: string;
  searchQuery: string;
  onPlay: (item: VodItem) => void;
}

export default function VodBrowser({ sessionId, categories: _categories, selectedCategoryId, searchQuery, onPlay }: Props) {
  const [items, setItems] = useState<VodItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<VodItem | null>(null);

  const fetchPage = useCallback(
    async (catId: string, p: number, replace: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const result = await getVodList(sessionId, catId === ALL_GENRE_ID ? "*" : catId, p);
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
    fetchPage(selectedCategoryId, 1, true);
  }, [selectedCategoryId, fetchPage]);

  const filtered = searchQuery.trim()
    ? items.filter((m) => m.name.toLowerCase().includes(searchQuery.toLowerCase()))
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
              {[selected.year, selected.duration ? `${selected.duration} min` : null, selected.rating ? `★ ${selected.rating}` : null]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {selected.director && <div className="vod-detail-sub">Director: {selected.director}</div>}
            {selected.actors && <div className="vod-detail-sub">Cast: {selected.actors}</div>}
            {selected.description && <div className="vod-detail-desc">{selected.description}</div>}
            <button className="vod-play-btn" onClick={() => onPlay(selected)}>
              ▶ Play
            </button>
          </div>
          <button className="vod-detail-close" onClick={() => setSelected(null)} aria-label="Close">×</button>
        </div>
      )}

      {error && <div className="vod-error">{error}</div>}

      {filtered.length === 0 && !loading ? (
        <div className="vod-empty">
          {searchQuery ? "No results match your search." : "No titles in this category."}
        </div>
      ) : (
        <div className="vod-grid">
          {filtered.map((item) => (
            <div
              key={item.id}
              className={`vod-card${selected?.id === item.id ? " selected" : ""}`}
              onClick={() => setSelected(item)}
            >
              {item.screenshot ? (
                <img className="vod-card-poster" src={item.screenshot} alt={item.name} loading="lazy" />
              ) : (
                <div className="vod-card-poster vod-poster-placeholder">{item.name.slice(0, 2).toUpperCase()}</div>
              )}
              <div className="vod-card-info">
                <div className="vod-card-title">{item.name}</div>
                <div className="vod-card-meta">{[item.year, item.rating ? `★ ${item.rating}` : null].filter(Boolean).join(" · ")}</div>
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
