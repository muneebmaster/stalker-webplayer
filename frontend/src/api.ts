import type {
  Channel,
  ConnectionResult,
  EpgProgram,
  Genre,
  SeriesEpisode,
  SeriesItem,
  StalkerCredentials,
  VodCategory,
  VodItem,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

class ApiError extends Error {}

async function request<T>(
  path: string,
  options: RequestInit & { sessionId?: string } = {}
): Promise<T> {
  const { sessionId, headers, ...rest } = options;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...(sessionId ? { "X-Session-Id": sessionId } : {}),
      ...headers,
    },
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request failed with status ${res.status}`);
  }
  return data as T;
}

export function connect(credentials: StalkerCredentials): Promise<ConnectionResult> {
  // Generous timeout: the backend rides out portal rate-limit (429) windows
  // with patient exponential backoff across the handshake/auth sequence, which
  // can legitimately take ~1 minute. Abort only well past that.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120_000);
  return request<ConnectionResult>("/api/connect", {
    method: "POST",
    body: JSON.stringify(credentials),
    signal: ac.signal,
  }).finally(() => clearTimeout(timer));
}

export function disconnect(sessionId: string): Promise<void> {
  return request("/api/disconnect", { method: "POST", sessionId, body: "{}" });
}

export async function getGenres(sessionId: string): Promise<Genre[]> {
  const data = await request<{ genres: Genre[] }>("/api/genres", { sessionId });
  return data.genres;
}

export async function getChannels(sessionId: string): Promise<Channel[]> {
  const data = await request<{ channels: Channel[] }>("/api/channels", { sessionId });
  return data.channels;
}

export async function getEpg(
  sessionId: string,
  channelId: string,
  options: { limit?: number; refresh?: boolean } = {}
): Promise<EpgProgram[]> {
  const { limit = 12, refresh = false } = options;
  const query = `limit=${limit}${refresh ? "&refresh=1" : ""}`;
  const data = await request<{ programs: EpgProgram[] }>(
    `/api/epg/${encodeURIComponent(channelId)}?${query}`,
    { sessionId }
  );
  return data.programs;
}

export async function getStreamUrl(sessionId: string, cmd: string): Promise<string> {
  const data = await request<{ url: string; proxyUrl: string }>(
    `/api/stream?cmd=${encodeURIComponent(cmd)}`,
    { sessionId }
  );
  return `${API_BASE}${data.proxyUrl}`;
}

export function logoUrl(src: string): string {
  if (!src) return "";
  return `${API_BASE}/api/proxy/logo?url=${encodeURIComponent(src)}`;
}

export async function getVodCategories(sessionId: string): Promise<VodCategory[]> {
  const data = await request<{ categories: VodCategory[] }>("/api/vod/categories", { sessionId });
  return data.categories;
}

export async function getVodList(
  sessionId: string,
  categoryId: string,
  page = 1,
  limit = 48
): Promise<{ items: VodItem[]; totalItems: number }> {
  return request<{ items: VodItem[]; totalItems: number }>(
    `/api/vod/list?categoryId=${encodeURIComponent(categoryId)}&page=${page}&limit=${limit}`,
    { sessionId }
  );
}

export async function getVodStream(
  sessionId: string,
  cmd: string,
  movieId?: string
): Promise<{ url: string; streamType: "hls" | "direct" }> {
  const qs = `cmd=${encodeURIComponent(cmd)}${movieId ? `&movieId=${encodeURIComponent(movieId)}` : ""}`;
  const data = await request<{ url: string; proxyUrl: string; streamType: "hls" | "direct" }>(
    `/api/vod/stream?${qs}`,
    { sessionId }
  );
  return { url: `${API_BASE}${data.proxyUrl}`, streamType: data.streamType ?? "hls" };
}

export async function getSeriesEpisodes(
  sessionId: string,
  seriesId: string
): Promise<SeriesEpisode[]> {
  const data = await request<{ episodes: SeriesEpisode[] }>(
    `/api/series/episodes?seriesId=${encodeURIComponent(seriesId)}`,
    { sessionId }
  );
  return data.episodes;
}

export async function getSeriesCategories(sessionId: string): Promise<VodCategory[]> {
  const data = await request<{ categories: VodCategory[] }>("/api/series/categories", { sessionId });
  return data.categories;
}

export async function getSeriesList(
  sessionId: string,
  categoryId: string,
  page = 1,
  limit = 48
): Promise<{ items: SeriesItem[]; totalItems: number }> {
  return request<{ items: SeriesItem[]; totalItems: number }>(
    `/api/series/list?categoryId=${encodeURIComponent(categoryId)}&page=${page}&limit=${limit}`,
    { sessionId }
  );
}
