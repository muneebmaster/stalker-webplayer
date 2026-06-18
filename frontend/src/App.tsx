import { useCallback, useEffect, useMemo, useState } from "react";
import LoginScreen from "./components/LoginScreen";
import TopBar, { type AppMode } from "./components/TopBar";
import GenreSidebar, { ALL_GENRE_ID, FAVOURITES_GENRE_ID } from "./components/GenreSidebar";
import VideoPlayer from "./components/VideoPlayer";
import NowPlayingPanel, { type MediaInfo } from "./components/NowPlayingPanel";
import EpgGrid, { type EpgSortMode } from "./components/EpgGrid";
import VodBrowser from "./components/VodBrowser";
import SeriesBrowser from "./components/SeriesBrowser";
import {
  connect,
  disconnect,
  getChannels,
  getGenres,
  getStreamUrl,
  getVodCategories,
  getVodStream,
  getSeriesCategories,
} from "./api";
import { findCurrentProgram, findNextProgram, useEpgCache } from "./hooks/useEpgCache";
import { useNow } from "./hooks/useNow";
import { useProfiles } from "./hooks/useProfiles";
import { useFavourites } from "./hooks/useFavourites";
import type {
  Channel,
  ConnectionResult,
  Genre,
  Profile,
  SeriesEpisode,
  StalkerCredentials,
  VodCategory,
  VodItem,
} from "./types";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function portalHost(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

export default function App() {
  const { profiles, saveProfile, deleteProfile } = useProfiles();
  const { isFavourite, toggleFavourite, favourites } = useFavourites();

  const [session, setSession] = useState<ConnectionResult | null>(null);
  const [autoConnecting, setAutoConnecting] = useState(false);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [genres, setGenres] = useState<Genre[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedGenreId, setSelectedGenreId] = useState<string>(ALL_GENRE_ID);
  const [searchQuery, setSearchQuery] = useState("");
  const [epgSortMode, setEpgSortMode] = useState<EpgSortMode>("number");

  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamType, setStreamType] = useState<"hls" | "direct">("hls");
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const [appMode, setAppMode] = useState<AppMode>("live");
  const [vodSubMode, setVodSubMode] = useState<"movies" | "series">("movies");
  const [vodCategories, setVodCategories] = useState<VodCategory[]>([]);
  const [seriesCategories, setSeriesCategories] = useState<VodCategory[]>([]);
  const [selectedVodCategoryId, setSelectedVodCategoryId] = useState<string>(ALL_GENRE_ID);
  const [selectedSeriesCategoryId, setSelectedSeriesCategoryId] = useState<string>(ALL_GENRE_ID);
  const [playingMedia, setPlayingMedia] = useState<{ name: string; year?: string; description?: string } | null>(null);

  const now = useNow();
  const { cache: epgCache, ensureLoaded: ensureEpgLoaded } = useEpgCache(session?.sessionId ?? null);

  const handleConnect = useCallback(async (credentials: StalkerCredentials, saveAs?: string) => {
    setConnectLoading(true);
    setConnectError(null);
    try {
      const result = await connect(credentials);
      const [genreList, channelList] = await Promise.all([
        getGenres(result.sessionId),
        getChannels(result.sessionId),
      ]);
      setSession(result);
      setGenres(genreList);
      setChannels(channelList);
      setSelectedGenreId(ALL_GENRE_ID);
      setSearchQuery("");
      setSelectedChannel(null);
      setStreamUrl(null);
      setAppMode("live");

      // Save profile with the resolved portal URL (matchedUrl from backend),
      // not the user-typed URL, so future reconnects skip candidate probing.
      if (saveAs) {
        saveProfile({
          name: saveAs,
          ...credentials,
          portalUrl: result.portalUrl,
        });
      }

      // Load VOD/series categories in background (non-blocking)
      getVodCategories(result.sessionId).then(setVodCategories).catch(() => {});
      getSeriesCategories(result.sessionId).then(setSeriesCategories).catch(() => {});
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnectLoading(false);
      setAutoConnecting(false);
    }
  }, [saveProfile]);

  const resetPlayer = useCallback(() => {
    setSelectedChannel(null);
    setStreamUrl(null);
    setStreamType("hls");
    setStreamError(null);
    setPlayingMedia(null);
  }, []);

  const handleDisconnect = useCallback(() => {
    if (session) disconnect(session.sessionId).catch(() => {});
    setSession(null);
    setGenres([]);
    setChannels([]);
    resetPlayer();
    setSelectedGenreId(ALL_GENRE_ID);
    setSearchQuery("");
    setVodCategories([]);
    setSeriesCategories([]);
  }, [session, resetPlayer]);

  const handleSwitchProfile = useCallback(async (profile: Profile) => {
    setAutoConnecting(true);
    if (session) disconnect(session.sessionId).catch(() => {});
    setSession(null);
    setGenres([]);
    setChannels([]);
    resetPlayer();
    setSelectedGenreId(ALL_GENRE_ID);
    setSearchQuery("");
    setVodCategories([]);
    setSeriesCategories([]);
    await handleConnect(profile);
  }, [session, handleConnect, resetPlayer]);

  const handleSelectChannel = useCallback(
    (channel: Channel) => {
      if (!session) return;
      setSelectedChannel(channel);
      setStreamUrl(null);
      setStreamType("hls");
      setStreamError(null);
      setStreamLoading(true);
      setPlayingMedia(null);
      getStreamUrl(session.sessionId, channel.cmd)
        .then((url) => setStreamUrl(url))
        .catch((err) => setStreamError(err instanceof Error ? err.message : String(err)))
        .finally(() => setStreamLoading(false));
    },
    [session]
  );

  const handlePlayVod = useCallback(
    async (item: VodItem) => {
      if (!session) return;
      setStreamUrl(null);
      setStreamType("hls");
      setStreamError(null);
      setStreamLoading(true);
      setSelectedChannel(null);
      setPlayingMedia({ name: item.name, year: item.year, description: item.description });
      try {
        const result = await getVodStream(session.sessionId, item.cmd, item.id);
        setStreamUrl(result.url);
        setStreamType(result.streamType);
      } catch (err) {
        setStreamError(err instanceof Error ? err.message : String(err));
      } finally {
        setStreamLoading(false);
      }
    },
    [session]
  );

  const handlePlayEpisode = useCallback(
    async (episode: SeriesEpisode, seriesName: string) => {
      if (!session) return;
      setStreamUrl(null);
      setStreamType("hls");
      setStreamError(null);
      setStreamLoading(true);
      setSelectedChannel(null);
      setPlayingMedia({ name: seriesName, description: episode.name ? `S${episode.season} E${episode.episode}: ${episode.name}` : undefined });
      try {
        const result = await getVodStream(session.sessionId, episode.cmd, episode.id);
        setStreamUrl(result.url);
        setStreamType(result.streamType);
      } catch (err) {
        setStreamError(err instanceof Error ? err.message : String(err));
      } finally {
        setStreamLoading(false);
      }
    },
    [session]
  );

  const favouriteChannels = useMemo(
    () => channels.filter((c) => isFavourite(c.name)),
    [channels, isFavourite, favourites]
  );

  const filteredChannels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let base = channels;
    if (selectedGenreId === FAVOURITES_GENRE_ID) {
      base = favouriteChannels;
    } else if (selectedGenreId !== ALL_GENRE_ID) {
      base = channels.filter((c) => c.genreId === selectedGenreId);
    }
    if (query) base = base.filter((c) => c.name.toLowerCase().includes(query));
    return base;
  }, [channels, selectedGenreId, searchQuery, favouriteChannels]);

  // Auto-play first channel when list loads
  useEffect(() => {
    if (appMode === "live" && !selectedChannel && filteredChannels.length > 0) {
      handleSelectChannel(filteredChannels[0]);
    }
  }, [filteredChannels, selectedChannel, handleSelectChannel, appMode]);

  const currentProgram = selectedChannel
    ? findCurrentProgram(epgCache[selectedChannel.id], now)
    : null;
  const nextProgram = selectedChannel
    ? findNextProgram(epgCache[selectedChannel.id], now)
    : null;

  const nowPlayingInfo = useMemo((): MediaInfo | null => {
    if (playingMedia) {
      return {
        entityName: playingMedia.name,
        entitySub: playingMedia.year,
        title: playingMedia.description,
      };
    }
    if (!selectedChannel) return null;
    const prog = currentProgram;
    const next = nextProgram;
    return {
      entityName: selectedChannel.name,
      entitySub: selectedChannel.number,
      logo: selectedChannel.logo,
      title: prog?.name,
      subtitle: prog ? `${formatTime(prog.startTimestamp)} – ${formatTime(prog.stopTimestamp)}` : undefined,
      description: prog?.description || undefined,
      progress: prog && now > prog.startTimestamp
        ? Math.min(1, (now - prog.startTimestamp) / (prog.stopTimestamp - prog.startTimestamp))
        : undefined,
      upNext: next?.name,
      upNextTime: next ? `${formatTime(next.startTimestamp)} – ${formatTime(next.stopTimestamp)}` : undefined,
    };
  }, [selectedChannel, playingMedia, currentProgram, nextProgram, now]);

  const currentDisplayName = useMemo(() => {
    if (!session) return "";
    const match = profiles.find((p) => {
      const macMatch = p.mac.toLowerCase() === session.mac.toLowerCase();
      try { return macMatch && new URL(p.portalUrl).host === new URL(session.portalUrl).host; }
      catch { return macMatch && p.portalUrl === session.portalUrl; }
    });
    return match?.name ?? portalHost(session.portalUrl);
  }, [session, profiles]);

  const sidebarCategories = appMode === "vod"
    ? (vodSubMode === "series" ? seriesCategories : vodCategories)
    : genres;
  const sidebarSelectedId = appMode === "vod"
    ? (vodSubMode === "series" ? selectedSeriesCategoryId : selectedVodCategoryId)
    : selectedGenreId;
  const onSidebarSelect = appMode === "vod"
    ? (vodSubMode === "series" ? setSelectedSeriesCategoryId : setSelectedVodCategoryId)
    : setSelectedGenreId;

  if (!session && !autoConnecting) {
    return (
      <LoginScreen
        onConnect={handleConnect}
        loading={connectLoading}
        error={connectError}
        profiles={profiles}
        onSaveProfile={saveProfile}
        onDeleteProfile={deleteProfile}
      />
    );
  }

  if (!session && autoConnecting) {
    return (
      <div className="app-loading">
        <div className="app-loading-spinner" />
        Connecting…
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar
        mode={appMode}
        onSetMode={setAppMode}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        profiles={profiles}
        currentPortalHost={currentDisplayName}
        onSwitchProfile={handleSwitchProfile}
        onDisconnect={handleDisconnect}
      />
      <div className="main">
        <GenreSidebar
          categories={sidebarCategories}
          selectedId={sidebarSelectedId}
          onSelect={onSidebarSelect}
          channels={appMode === "live" ? channels : undefined}
          showFavourites={appMode === "live"}
          favouriteCount={favouriteChannels.length}
        />
        <div className="content">
          <div className="player-row">
            <VideoPlayer
              src={streamUrl}
              channel={selectedChannel}
              loading={streamLoading}
              resolveError={streamError}
              streamType={streamType}
            />
            <NowPlayingPanel info={nowPlayingInfo} />
          </div>
          {appMode === "live" && (
            <EpgGrid
              channels={filteredChannels}
              epgCache={epgCache}
              ensureEpgLoaded={ensureEpgLoaded}
              now={now}
              selectedChannelId={selectedChannel?.id ?? null}
              onSelectChannel={handleSelectChannel}
              sortMode={epgSortMode}
              onToggleSort={() => setEpgSortMode((m) => (m === "number" ? "name" : "number"))}
              isFavourite={isFavourite}
              onToggleFavourite={toggleFavourite}
            />
          )}
          {appMode === "vod" && session && (
            <>
              <div className="vod-sub-tabs">
                <button
                  className={`vod-sub-tab${vodSubMode === "movies" ? " active" : ""}`}
                  onClick={() => setVodSubMode("movies")}
                >
                  Movies
                </button>
                <button
                  className={`vod-sub-tab${vodSubMode === "series" ? " active" : ""}`}
                  onClick={() => setVodSubMode("series")}
                >
                  Series
                </button>
              </div>
              {vodSubMode === "movies" ? (
                <VodBrowser
                  sessionId={session.sessionId}
                  categories={vodCategories}
                  selectedCategoryId={selectedVodCategoryId}
                  searchQuery={searchQuery}
                  onPlay={handlePlayVod}
                />
              ) : (
                <SeriesBrowser
                  sessionId={session.sessionId}
                  categories={seriesCategories}
                  selectedCategoryId={selectedSeriesCategoryId}
                  searchQuery={searchQuery}
                  onPlay={handlePlayEpisode}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
