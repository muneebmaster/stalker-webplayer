import type { Profile } from "./types";

const BACKUP_VERSION = 1;

export interface BackupData {
  version: number;
  exportedAt: string;
  profiles: Profile[];
  favourites: string[];
}

/** Serialize profiles + favourites to a JSON file and trigger a download. */
export function downloadBackup(profiles: Profile[], favourites: string[]): void {
  const data: BackupData = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    profiles,
    favourites,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stalker-webplayer-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Parse and validate a backup file, tolerating partial/legacy contents. */
export async function readBackup(file: File): Promise<BackupData> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("Not a valid JSON file.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Unrecognised backup file.");
  }
  const obj = parsed as Record<string, unknown>;
  const profiles = Array.isArray(obj.profiles)
    ? (obj.profiles.filter((p) => p && typeof p === "object") as Profile[])
    : [];
  const favourites = Array.isArray(obj.favourites)
    ? (obj.favourites.filter((f): f is string => typeof f === "string"))
    : [];
  if (profiles.length === 0 && favourites.length === 0) {
    throw new Error("No profiles or favourites found in this file.");
  }
  return {
    version: typeof obj.version === "number" ? obj.version : BACKUP_VERSION,
    exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : "",
    profiles,
    favourites,
  };
}
