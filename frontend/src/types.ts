export interface Genre {
  id: string;
  title: string;
  alias?: string;
}

export interface Channel {
  id: string;
  name: string;
  number: string;
  logo: string;
  cmd: string;
  genreId: string;
  epgId: string;
  tvArchive: boolean;
  tvArchiveDuration: number;
}

export interface EpgProgram {
  id: string;
  channelId: string;
  name: string;
  description: string;
  startTimestamp: number;
  stopTimestamp: number;
}

export interface ConnectionResult {
  sessionId: string;
  portalUrl: string;
  mac: string;
  profile: Record<string, unknown>;
  accountInfo: Record<string, unknown> | null;
}

export interface StalkerCredentials {
  portalUrl: string;
  mac: string;
  login?: string;
  password?: string;
  serialNumber?: string;
  deviceId?: string;
  deviceId2?: string;
}

export type EpgSortMode = "number" | "name";

export interface Profile {
  id: string;
  name: string;
  portalUrl: string;
  mac: string;
  login?: string;
  password?: string;
  serialNumber?: string;
  deviceId?: string;
  deviceId2?: string;
  // Per-profile live-TV view state, restored on reconnect.
  sortMode?: EpgSortMode;
  lastGenreId?: string;
  lastChannelId?: string;
}

export interface VodCategory {
  id: string;
  title: string;
}

export interface VodItem {
  id: string;
  name: string;
  cmd: string;
  categoryId: string;
  screenshot: string;
  description: string;
  year: string;
  duration: string;
  director: string;
  actors: string;
  rating: string;
}

export interface SeriesEpisode {
  id: string;
  seriesId: string;
  name: string;
  season: number;
  episode: number;
  cmd: string;
}

export interface SeriesItem {
  id: string;
  name: string;
  categoryId: string;
  screenshot: string;
  description: string;
  year: string;
  episodes: SeriesEpisode[];
}
