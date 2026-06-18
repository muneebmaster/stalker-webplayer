import { ChangeEvent, FormEvent, useRef, useState } from "react";
import type { Profile, StalkerCredentials } from "../types";

interface ImportResult {
  addedProfiles: number;
  skippedProfiles: number;
  favourites: number;
}

interface Props {
  onConnect: (credentials: StalkerCredentials, saveAs?: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  profiles: Profile[];
  onSaveProfile: (profile: Omit<Profile, "id">) => void;
  onDeleteProfile: (id: string) => void;
  onExportData: () => void;
  onImportData: (file: File) => Promise<ImportResult>;
  hasData: boolean;
}

function portalHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default function LoginScreen({
  onConnect,
  loading,
  error,
  profiles,
  onSaveProfile,
  onDeleteProfile,
  onExportData,
  onImportData,
  hasData,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ""; // allow re-importing the same file
    if (!file) return;
    setImportStatus(null);
    setImportError(null);
    try {
      const result = await onImportData(file);
      const parts = [`${result.addedProfiles} profile(s)`, `${result.favourites} favourite(s)`];
      const skipped = result.skippedProfiles > 0 ? ` (${result.skippedProfiles} duplicate profile(s) skipped)` : "";
      setImportStatus(`Imported ${parts.join(" and ")}${skipped}.`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed.");
    }
  };
  const [portalUrl, setPortalUrl] = useState("");
  const [mac, setMac] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [deviceId2, setDeviceId2] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [saveProfile, setSaveProfile] = useState(false);
  const [showForm, setShowForm] = useState(profiles.length === 0);

  const loadProfile = (p: Profile) => {
    setPortalUrl(p.portalUrl);
    setMac(p.mac);
    setLogin(p.login ?? "");
    setPassword(p.password ?? "");
    setSerialNumber(p.serialNumber ?? "");
    setDeviceId(p.deviceId ?? "");
    setDeviceId2(p.deviceId2 ?? "");
    setProfileName(p.name);
    setShowAdvanced(Boolean(p.serialNumber || p.deviceId));
    setShowForm(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const credentials: StalkerCredentials = {
      portalUrl: portalUrl.trim(),
      mac: mac.trim().toUpperCase(),
      login: login.trim() || undefined,
      password: password || undefined,
      serialNumber: serialNumber.trim() || undefined,
      deviceId: deviceId.trim() || undefined,
      deviceId2: deviceId2.trim() || undefined,
    };
    // Pass the profile name to onConnect so it can save with the resolved
    // portal URL (matchedUrl) rather than the user-typed URL. Saving here
    // with the raw input would cause repeated candidate probing on reconnect.
    await onConnect(credentials, saveProfile && profileName.trim() ? profileName.trim() : undefined);
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>
          <span className="logo-dot" />
          Stalker Web Player
        </h1>
        <p className="subtitle">Connect to your Stalker / Ministra IPTV portal</p>

        {profiles.length > 0 && (
          <div className="profile-cards">
            {profiles.map((p) => (
              <div key={p.id} className="profile-card">
                <button className="profile-card-connect" onClick={() => loadProfile(p)}>
                  <div className="profile-card-name">{p.name}</div>
                  <div className="profile-card-host">{portalHost(p.portalUrl)}</div>
                  <div className="profile-card-mac">{p.mac}</div>
                </button>
                <button
                  className="profile-card-delete"
                  aria-label="Delete profile"
                  onClick={(e) => { e.stopPropagation(); onDeleteProfile(p.id); }}
                >
                  ×
                </button>
              </div>
            ))}
            <button className="profile-card profile-card-add" onClick={() => {
              setPortalUrl(""); setMac(""); setLogin(""); setPassword("");
              setSerialNumber(""); setDeviceId(""); setDeviceId2("");
              setProfileName(""); setShowAdvanced(false); setShowForm(true);
            }}>
              <span className="profile-card-add-icon">+</span>
              <span>Add Profile</span>
            </button>
          </div>
        )}

        {showForm && (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="portalUrl">Portal URL</label>
              <input
                id="portalUrl"
                type="text"
                placeholder="http://your-provider.com/c/ or .../load.php"
                value={portalUrl}
                onChange={(e) => setPortalUrl(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="mac">MAC Address</label>
              <input
                id="mac"
                type="text"
                placeholder="00:1A:79:00:00:00"
                value={mac}
                onChange={(e) => setMac(e.target.value)}
                required
              />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="login">Login (optional)</label>
                <input id="login" type="text" value={login} onChange={(e) => setLogin(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="password">Password (optional)</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <button
              type="button"
              className="advanced-toggle"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "− Hide advanced device settings" : "+ Advanced device settings"}
            </button>

            {showAdvanced && (
              <div className="advanced-section">
                <div className="field">
                  <label htmlFor="serialNumber">Serial Number (sn)</label>
                  <input
                    id="serialNumber"
                    type="text"
                    placeholder="Leave blank to derive from MAC"
                    value={serialNumber}
                    onChange={(e) => setSerialNumber(e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="deviceId">Device ID</label>
                    <input
                      id="deviceId"
                      type="text"
                      placeholder="Leave blank"
                      value={deviceId}
                      onChange={(e) => setDeviceId(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="deviceId2">Device ID 2</label>
                    <input
                      id="deviceId2"
                      type="text"
                      placeholder="Defaults to Device ID"
                      value={deviceId2}
                      onChange={(e) => setDeviceId2(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="save-profile-row">
              <label className="save-profile-toggle">
                <input
                  type="checkbox"
                  checked={saveProfile}
                  onChange={(e) => setSaveProfile(e.target.checked)}
                />
                Save as profile
              </label>
              {saveProfile && (
                <input
                  className="save-profile-name"
                  type="text"
                  placeholder="Profile name"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                />
              )}
            </div>

            <button className="login-submit" type="submit" disabled={loading}>
              {loading ? "Connecting…" : "Connect"}
            </button>

            {error && <div className="login-error">{error}</div>}
          </form>
        )}

        {!showForm && (
          <>
            <button className="advanced-toggle" style={{ marginTop: 4 }} onClick={() => setShowForm(true)}>
              + Connect manually
            </button>
            {error && <div className="login-error">{error}</div>}
          </>
        )}

        <p className="login-hint">
          Click a saved profile to connect, or enter details manually. The portal URL is the
          address your provider gave you for MAG/STB devices.
        </p>

        <div className="backup-row">
          <button type="button" className="backup-btn" onClick={onExportData} disabled={!hasData}>
            Export profiles &amp; favourites
          </button>
          <button type="button" className="backup-btn" onClick={() => fileInputRef.current?.click()}>
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={handleImportFile}
          />
        </div>
        {importStatus && <div className="backup-status">{importStatus}</div>}
        {importError && <div className="login-error">{importError}</div>}
      </div>
    </div>
  );
}
