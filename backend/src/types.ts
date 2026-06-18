export interface StalkerCredentials {
  /** Full URL to the portal's load.php endpoint, e.g. http://host:port/stalker_portal/server/load.php */
  portalUrl: string;
  /** Device MAC address, e.g. 00:1A:79:XX:XX:XX */
  mac: string;
  /** Optional account login (for portals that require do_auth) */
  login?: string;
  /** Optional account password (for portals that require do_auth) */
  password?: string;
  /** Optional device serial number (sn), required by some portals to match a registered device */
  serialNumber?: string;
  /** Optional device_id (sha256 hex), defaults to a hash derived from the MAC */
  deviceId?: string;
  /** Optional device_id2, defaults to the same value as deviceId */
  deviceId2?: string;
}

export interface StalkerProfile {
  id?: string;
  name?: string;
  status?: number;
  expireBillingDate?: string;
  [key: string]: unknown;
}

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

export interface SessionInfo {
  sessionId: string;
  profile: StalkerProfile;
  accountInfo: Record<string, unknown> | null;
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
