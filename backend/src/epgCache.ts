import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { EpgProgram } from "./types.js";

const STALENESS_HOURS = Number(process.env.EPG_STALENESS_HOURS ?? 12);
const STALENESS_MS = STALENESS_HOURS * 60 * 60 * 1000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Stored at <repo>/data/epg-cache.db (two levels up from dist/src or src)
const DATA_DIR = path.resolve(__dirname, "..", "..", "data");
const DB_PATH = path.join(DATA_DIR, "epg-cache.db");

function openDb(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS epg_cache (
      portal_host TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      programs    TEXT NOT NULL,
      fetched_at  INTEGER NOT NULL,
      PRIMARY KEY (portal_host, channel_id)
    )
  `);
  // Prune stale rows on startup
  const cutoff = Date.now() - STALENESS_MS;
  db.prepare("DELETE FROM epg_cache WHERE fetched_at < ?").run(cutoff);
  return db;
}

const db = openDb();

const stmtGet = db.prepare<[string, string, number]>(
  "SELECT programs FROM epg_cache WHERE portal_host = ? AND channel_id = ? AND fetched_at >= ?"
);
const stmtGetAny = db.prepare<[string, string]>(
  "SELECT programs FROM epg_cache WHERE portal_host = ? AND channel_id = ?"
);
const stmtSet = db.prepare<[string, string, string, number]>(
  "INSERT OR REPLACE INTO epg_cache (portal_host, channel_id, programs, fetched_at) VALUES (?, ?, ?, ?)"
);

function parseRow(row: { programs: string } | undefined): EpgProgram[] | null {
  if (!row) return null;
  try {
    return JSON.parse(row.programs) as EpgProgram[];
  } catch {
    return null;
  }
}

export function epgCacheGet(portalHost: string, channelId: string): EpgProgram[] | null {
  const cutoff = Date.now() - STALENESS_MS;
  return parseRow(stmtGet.get(portalHost, channelId, cutoff) as { programs: string } | undefined);
}

/** Returns the cached programmes ignoring staleness — used to merge on refresh. */
export function epgCacheGetAny(portalHost: string, channelId: string): EpgProgram[] | null {
  return parseRow(stmtGetAny.get(portalHost, channelId) as { programs: string } | undefined);
}

export function epgCacheSet(portalHost: string, channelId: string, programs: EpgProgram[]): void {
  stmtSet.run(portalHost, channelId, JSON.stringify(programs), Date.now());
}

/**
 * Merges freshly fetched programmes into the existing set so coverage only
 * grows: keyed by start time (fresh wins on conflict), dropping anything that
 * ended more than two hours ago so the array stays bounded over a long session.
 */
export function mergePrograms(existing: EpgProgram[], fresh: EpgProgram[]): EpgProgram[] {
  const keepSince = Date.now() - 2 * 60 * 60 * 1000;
  const byStart = new Map<number, EpgProgram>();
  for (const p of existing) {
    if (p.stopTimestamp >= keepSince) byStart.set(p.startTimestamp, p);
  }
  for (const p of fresh) byStart.set(p.startTimestamp, p);
  return [...byStart.values()].sort((a, b) => a.startTimestamp - b.startTimestamp);
}
