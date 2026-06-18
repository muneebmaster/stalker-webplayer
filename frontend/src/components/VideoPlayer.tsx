import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import type { Channel } from "../types";

const OVERLAY_HIDE_DELAY = 3000;
const OVERLAYS_PREF_KEY = "stalker-webplayer:overlays";

interface Props {
  src: string | null;
  channel: Channel | null;
  loading: boolean;
  resolveError?: string | null;
  /** Whether the stream is HLS (default) or a direct video file (mp4, ts, etc.) */
  streamType?: "hls" | "direct";
}

function resolutionLabel(height: number): string {
  if (height >= 2160) return "4K";
  if (height >= 1080) return "FHD";
  if (height >= 720) return "HD";
  return "SD";
}

function fpsLabel(rate: number): string | null {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return `${Math.round(rate)} FPS`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}

function VolumeIcon({ muted }: { muted: boolean }) {
  if (muted) {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M3 9v6h4l5 5V4L7 9H3z" />
        <path d="M15.5 12l2.5-2.5-1.06-1.06L14.44 10.94 11.94 8.44 10.88 9.5 13.38 12l-2.5 2.5 1.06 1.06 2.5-2.5 2.5 2.5 1.06-1.06z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3zM16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.26 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M7 14H5v5h5v-2H7v-3zM5 10h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  if (off) {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
    </svg>
  );
}

export default function VideoPlayer({ src, channel, loading, resolveError, streamType = "hls" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [resolution, setResolution] = useState<string | null>(null);
  const [fps, setFps] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlaysEnabled, setOverlaysEnabled] = useState(() => {
    try {
      return localStorage.getItem(OVERLAYS_PREF_KEY) !== "false";
    } catch {
      return true;
    }
  });

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowOverlay(false), OVERLAY_HIDE_DELAY);
  }, []);

  const handleMouseMove = useCallback(() => {
    setShowOverlay(true);
    scheduleHide();
  }, [scheduleHide]);

  const handleMouseLeave = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setShowOverlay(false);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setResolution(null);
    setFps(null);
    setDuration(0);
    setCurrentTime(0);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (!src) {
      video.removeAttribute("src");
      video.load();
      return;
    }

    // Direct video file (mp4, ts, etc.) — bypass hls.js entirely
    if (streamType === "direct") {
      const onErr = () => {
        const code = video.error?.code ?? 0;
        const msgs: Record<number, string> = {
          1: "Playback aborted",
          2: "Network error loading video",
          3: "Video decoding error — format may be unsupported",
          4: "Video format not supported by this browser",
        };
        setError(msgs[code] ?? `Video error (code ${code})`);
      };
      video.addEventListener("error", onErr);
      video.src = src;
      video.play().catch(() => {});
      return () => video.removeEventListener("error", onErr);
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) setError(`Playback error: ${data.details}`);
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
        const level = hls.levels[data.level];
        if (level?.height) setResolution(resolutionLabel(level.height));
        // Instant hint from the manifest's FRAME-RATE attribute; the
        // requestVideoFrameCallback measurement below refines/overrides it.
        const rate = Number(level?.frameRate ?? level?.attrs?.["FRAME-RATE"]);
        const label = fpsLabel(rate);
        if (label) setFps((prev) => prev ?? label);
      });
      video.play().catch(() => {});
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.play().catch(() => {});
    } else {
      setError("HLS playback is not supported in this browser.");
    }

    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [src, streamType]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onMeta = () => {
      if (video.videoHeight) setResolution((prev) => prev ?? resolutionLabel(video.videoHeight));
      if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
    };
    const onDuration = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
    };
    const onTime = () => setCurrentTime(video.currentTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("resize", onMeta);
    video.addEventListener("durationchange", onDuration);
    video.addEventListener("timeupdate", onTime);
    return () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("resize", onMeta);
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("timeupdate", onTime);
    };
  }, [src]);

  // Measure the actual displayed frame rate via requestVideoFrameCallback.
  // Works uniformly for HLS and direct files; samples ~1s of media time per
  // reading and snaps to the nearest whole FPS (e.g. 23.976 → 24, 59.94 → 60).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src || typeof video.requestVideoFrameCallback !== "function") return;
    let handle = 0;
    let anchor: { time: number; frames: number } | null = null;
    const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      if (anchor && meta.mediaTime - anchor.time >= 1) {
        const label = fpsLabel((meta.presentedFrames - anchor.frames) / (meta.mediaTime - anchor.time));
        if (label) setFps(label);
        anchor = { time: meta.mediaTime, frames: meta.presentedFrames };
      } else if (!anchor) {
        anchor = { time: meta.mediaTime, frames: meta.presentedFrames };
      }
      handle = video.requestVideoFrameCallback(onFrame);
    };
    handle = video.requestVideoFrameCallback(onFrame);
    return () => video.cancelVideoFrameCallback(handle);
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => { setPlaying(true); scheduleHide(); };
    const onPause = () => { setPlaying(false); setShowOverlay(true); if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => { video.removeEventListener("play", onPlay); video.removeEventListener("pause", onPause); };
  }, [scheduleHide]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Number(e.target.value);
    setCurrentTime(Number(e.target.value));
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }, []);

  const handleVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    const value = Number(e.target.value);
    setVolume(value);
    if (video) { video.volume = value; video.muted = value === 0; setMuted(value === 0); }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else wrap.requestFullscreen().catch(() => {});
  }, []);

  const toggleOverlays = useCallback(() => {
    setOverlaysEnabled((v) => {
      const next = !v;
      try { localStorage.setItem(OVERLAYS_PREF_KEY, String(next)); } catch { /* */ }
      return next;
    });
  }, []);

  const controlsVisible = showOverlay || !playing;
  const isLive = channel !== null;

  return (
    <div
      className={`player-wrap${!controlsVisible ? " cursor-hidden" : ""}`}
      ref={wrapRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <video ref={videoRef} playsInline onClick={togglePlay} />
      {!src && !loading && !error && (
        <div className="player-placeholder">Select a channel to start watching</div>
      )}
      {loading && <div className="player-placeholder">Loading stream…</div>}
      {(error || resolveError) && <div className="player-error">{error ?? resolveError}</div>}
      {src && !error && !resolveError && (
        <>
          {overlaysEnabled && controlsVisible && (resolution || fps || channel) && (
            <div className="player-badges">
              {channel && <span className="player-badge live">LIVE</span>}
              {resolution && <span className="player-badge">{resolution}</span>}
              {fps && <span className="player-badge">{fps}</span>}
            </div>
          )}
          <div className={`player-controls${controlsVisible ? " visible" : ""}`}>
            {!isLive && Number.isFinite(duration) && duration > 0 && (
              <div className="player-seek-row">
                <input
                  className="seek-bar"
                  type="range"
                  min={0}
                  max={duration}
                  step={1}
                  value={currentTime}
                  onChange={handleSeek}
                  aria-label="Seek"
                />
                <span className="player-time">
                  {formatDuration(currentTime)} / {formatDuration(duration)}
                </span>
              </div>
            )}
            <div className="player-controls-row">
              <button className="player-btn" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
                {playing ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button className="player-btn" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
                <VolumeIcon muted={muted || volume === 0} />
              </button>
              <input
                className="volume-slider"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={handleVolume}
                aria-label="Volume"
              />
              <div className="player-spacer" />
              <button
                className={`player-btn player-btn-sm${overlaysEnabled ? "" : " dim"}`}
                onClick={toggleOverlays}
                aria-label={overlaysEnabled ? "Hide overlays" : "Show overlays"}
                title={overlaysEnabled ? "Hide quality overlays" : "Show quality overlays"}
              >
                <EyeIcon off={!overlaysEnabled} />
              </button>
              <button className="player-btn" onClick={toggleFullscreen} aria-label="Fullscreen">
                <FullscreenIcon />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
