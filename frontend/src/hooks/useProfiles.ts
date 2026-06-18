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

  return { profiles, saveProfile, updateProfile, deleteProfile };
}
