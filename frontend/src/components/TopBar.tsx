import { useState, useRef, useEffect } from "react";
import type { Profile } from "../types";

export type AppMode = "live" | "vod";

interface Props {
  mode: AppMode;
  onSetMode: (mode: AppMode) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  profiles: Profile[];
  currentPortalHost: string;
  onSwitchProfile: (profile: Profile) => void;
  onDisconnect: () => void;
}

const MODES: { id: AppMode; label: string }[] = [
  { id: "live", label: "Live TV" },
  { id: "vod", label: "VOD" },
];

export default function TopBar({
  mode,
  onSetMode,
  searchQuery,
  onSearchChange,
  profiles,
  currentPortalHost,
  onSwitchProfile,
  onDisconnect,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  return (
    <div className="topbar">
      <div className="brand">
        <span className="logo-dot" />
        Stalker Web Player
      </div>

      <div className="mode-tabs">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`mode-tab${mode === m.id ? " active" : ""}`}
            onClick={() => onSetMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="topbar-spacer" />

      <input
        className="topbar-search"
        type="search"
        placeholder={mode === "live" ? "Search channels…" : "Search VOD…"}
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
      />

      <div className="profile-switcher" ref={dropdownRef}>
        <button
          className="profile-switcher-trigger"
          onClick={() => setDropdownOpen((v) => !v)}
          title="Switch profile"
        >
          {currentPortalHost || "Profile"}
          <span className="profile-switcher-arrow">{dropdownOpen ? "▲" : "▼"}</span>
        </button>
        {dropdownOpen && (
          <div className="profile-switcher-dropdown">
            {profiles.map((p) => (
              <button
                key={p.id}
                className="profile-switcher-item"
                onClick={() => { setDropdownOpen(false); onSwitchProfile(p); }}
              >
                <span className="profile-switcher-name">{p.name}</span>
                <span className="profile-switcher-host">{p.portalUrl.replace(/^https?:\/\//, "").split("/")[0]}</span>
              </button>
            ))}
            <div className="profile-switcher-divider" />
            <button className="profile-switcher-item profile-switcher-disconnect" onClick={() => { setDropdownOpen(false); onDisconnect(); }}>
              Disconnect
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
