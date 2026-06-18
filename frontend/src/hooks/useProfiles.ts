import { useCallback, useState } from "react";
import type { Profile } from "../types";

const STORAGE_KEY = "stalker-webplayer:profiles";

function load(): Profile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Profile[]) : [];
  } catch {
    return [];
  }
}

function save(profiles: Profile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>(load);

  const saveProfile = useCallback((profile: Omit<Profile, "id">) => {
    const existing = load();
    const id = String(Date.now());
    const next = [...existing, { ...profile, id }];
    save(next);
    setProfiles(next);
    return id;
  }, []);

  const updateProfile = useCallback((id: string, patch: Partial<Omit<Profile, "id">>) => {
    const existing = load();
    const next = existing.map((p) => (p.id === id ? { ...p, ...patch } : p));
    save(next);
    setProfiles(next);
  }, []);

  const deleteProfile = useCallback((id: string) => {
    const existing = load();
    const next = existing.filter((p) => p.id !== id);
    save(next);
    setProfiles(next);
  }, []);

  // Merge imported profiles into the existing list, skipping any that already
  // match on portal URL + MAC (the same pair the app uses to identify a
  // profile) and assigning fresh ids to avoid collisions. Returns how many
  // were actually added.
  const importProfiles = useCallback((incoming: Profile[]) => {
    const existing = load();
    const seen = new Set(existing.map((p) => `${p.portalUrl}|${p.mac}`.toLowerCase()));
    const added = incoming.filter((p) => !seen.has(`${p.portalUrl}|${p.mac}`.toLowerCase()));
    const next = [...existing, ...added.map((p, i) => ({ ...p, id: `${Date.now()}-${i}` }))];
    save(next);
    setProfiles(next);
    return added.length;
  }, []);

  return { profiles, saveProfile, updateProfile, deleteProfile, importProfiles };
}
