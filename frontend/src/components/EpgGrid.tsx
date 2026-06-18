import { useMemo, useState, useRef, useCallback } from "react";
import type { Channel, EpgProgram } from "../types";
import { findCurrentProgram } from "../hooks/useEpgCache";
import { useVisibilityEffect } from "../hooks/useVisibility";
import { logoUrl } from "../api";

const PIXELS_PER_MINUTE = 4;
const WINDOW_MINUTES = 360; // 6 hour timeline
const HOUR_WIDTH = 60 * PIXELS_PER_MINUTE;
const DEFAULT_CHANNEL_COL_WIDTH = 260;
const MIN_CHANNEL_COL_WIDTH = 150;
const MAX_CHANNEL_COL_WIDTH = 520;
const TIMELINE_WIDTH = WINDOW_MINUTES * PIXELS_PER_MINUTE;

export type EpgSortMode = "number" | "name";

function formatHour(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

interface RowProps {
  channel: Channel;
  programs: EpgProgram[] | undefined;
  timelineStart: number;
  timelineEnd: number;
  now: number;
  selected: boolean;
  isFavourite: boolean;
  totalWidth: number;
  onVisible: (channelId: string) => void;
  onSelect: (channel: Channel) => void;
  onToggleFavourite: (channelName: string) => void;
}

function EpgRow({
  channel,
  programs,
  timelineStart,
  timelineEnd,
  now,
  selected,
  isFavourite,
  totalWidth,
  onVisible,
  onSelect,
  onToggleFavourite,
}: RowProps) {
  const ref = useVisibilityEffect<HTMLDivElement>(() => onVisible(channel.id));
  const current = findCurrentProgram(programs, now);

  const blocks = (programs ?? []).filter(
    (p) => p.stopTimestamp > timelineStart && p.startTimestamp < timelineEnd
  );

  return (
    <div ref={ref} className={`epg-row${selected ? " selected" : ""}`} style={{ width: totalWidth }}>
      <div className="epg-channel-col" onClick={() => onSelect(channel)}>
        <div className="channel-number">{channel.number}</div>
        <div className="channel-logo">
          {channel.logo ? (
            <img src={logoUrl(channel.logo)} alt="" loading="lazy" />
          ) : (
            <span className="placeholder">{channel.name.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="channel-meta">
          <div className="channel-name" title={channel.name}>{channel.name}</div>
          <div className="channel-program">{current ? current.name : " "}</div>
        </div>
        <button
          className={`channel-fav-btn${isFavourite ? " active" : ""}`}
          aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}
          onClick={(e) => { e.stopPropagation(); onToggleFavourite(channel.name); }}
          title={isFavourite ? "Remove from favourites" : "Add to favourites"}
        >
          {isFavourite ? "★" : "☆"}
        </button>
      </div>
      <div className="epg-row-timeline" style={{ width: TIMELINE_WIDTH }} onClick={() => onSelect(channel)}>
        {blocks.length === 0 && programs && <div className="epg-empty-row">No programme data</div>}
        {blocks.map((p) => {
          const start = Math.max(p.startTimestamp, timelineStart);
          const end = Math.min(p.stopTimestamp, timelineEnd);
          const left = ((start - timelineStart) / 60000) * PIXELS_PER_MINUTE;
          const width = Math.max(((end - start) / 60000) * PIXELS_PER_MINUTE, 6);
          const isLive = p.startTimestamp <= now && now < p.stopTimestamp;
          return (
            <div
              key={p.id}
              className={`epg-program${isLive ? " live" : ""}`}
              style={{ left, width }}
              title={p.description || p.name}
            >
              <div className="epg-program-title">{p.name}</div>
              <div className="epg-program-time">
                {formatHour(p.startTimestamp)} – {formatHour(p.stopTimestamp)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  channels: Channel[];
  epgCache: Record<string, EpgProgram[]>;
  ensureEpgLoaded: (channelId: string) => void;
  now: number;
  selectedChannelId: string | null;
  onSelectChannel: (channel: Channel) => void;
  sortMode: EpgSortMode;
  onToggleSort: () => void;
  isFavourite: (channelName: string) => boolean;
  onToggleFavourite: (channelName: string) => void;
}

export default function EpgGrid({
  channels,
  epgCache,
  ensureEpgLoaded,
  now,
  selectedChannelId,
  onSelectChannel,
  sortMode,
  onToggleSort,
  isFavourite,
  onToggleFavourite,
}: Props) {
  const [channelColWidth, setChannelColWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("epg-channel-col-width");
      if (saved) {
        const n = Number(saved);
        if (n >= MIN_CHANNEL_COL_WIDTH && n <= MAX_CHANNEL_COL_WIDTH) return n;
      }
    } catch { /* ignore */ }
    return DEFAULT_CHANNEL_COL_WIDTH;
  });

  // Keep a ref so the drag closure always reads the latest width without re-binding.
  const widthRef = useRef(channelColWidth);
  widthRef.current = channelColWidth;

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (me: MouseEvent) => {
      const next = Math.min(MAX_CHANNEL_COL_WIDTH, Math.max(MIN_CHANNEL_COL_WIDTH, startWidth + me.clientX - startX));
      setChannelColWidth(next);
      widthRef.current = next;
    };

    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try { localStorage.setItem("epg-channel-col-width", String(widthRef.current)); } catch { /* ignore */ }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const timelineStart = useMemo(() => {
    const hourMs = 3600000;
    return Math.floor(now / hourMs) * hourMs - 30 * 60000;
  }, [now]);
  const timelineEnd = timelineStart + WINDOW_MINUTES * 60000;

  const hourTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let t = timelineStart; t <= timelineEnd; t += 3600000) {
      ticks.push(t);
    }
    return ticks;
  }, [timelineStart, timelineEnd]);

  const sortedChannels = useMemo(() => {
    if (sortMode === "name") {
      return [...channels].sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...channels].sort((a, b) => Number(a.number) - Number(b.number));
  }, [channels, sortMode]);

  const totalWidth = channelColWidth + TIMELINE_WIDTH;
  const nowLineLeft = channelColWidth + ((now - timelineStart) / 60000) * PIXELS_PER_MINUTE;
  const sortLabel = sortMode === "number" ? "# → Name" : "A → #";

  return (
    <div
      className="epg"
      style={{ "--epg-channel-col-width": `${channelColWidth}px` } as React.CSSProperties}
    >
      <div className="epg-scroll">
        <div className="epg-header" style={{ width: totalWidth }}>
          <div className="epg-header-channel-col">
            <button className="epg-sort-btn" onClick={onToggleSort} title={`Sort: ${sortLabel}`}>
              Channels
              <span className="epg-sort-icon">{sortMode === "number" ? " ↑#" : " ↑A"}</span>
            </button>
            <div
              className="epg-channel-resize-handle"
              onMouseDown={handleResizeStart}
              title="Drag to resize channel column"
            />
          </div>
          <div className="epg-timeline-header" style={{ width: TIMELINE_WIDTH }}>
            {hourTicks.map((t) => (
              <div className="epg-hour-tick" key={t} style={{ flexBasis: HOUR_WIDTH }}>
                {formatHour(t)}
              </div>
            ))}
          </div>
        </div>
        <div className="epg-body" style={{ width: totalWidth }}>
          <div className="now-line" style={{ left: nowLineLeft }} />
          {sortedChannels.length === 0 ? (
            <div className="epg-empty">No channels match this filter.</div>
          ) : (
            sortedChannels.map((channel) => (
              <EpgRow
                key={channel.id}
                channel={channel}
                programs={epgCache[channel.id]}
                timelineStart={timelineStart}
                timelineEnd={timelineEnd}
                now={now}
                selected={channel.id === selectedChannelId}
                isFavourite={isFavourite(channel.name)}
                totalWidth={totalWidth}
                onVisible={ensureEpgLoaded}
                onSelect={onSelectChannel}
                onToggleFavourite={onToggleFavourite}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
