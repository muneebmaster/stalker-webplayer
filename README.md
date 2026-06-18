# Stalker Web Player

A web-based IPTV player for **Stalker / Ministra middleware** portals, with a
TiviMate-inspired dark interface: EPG grid, live preview, VOD, and series
browsing — all in the browser.

Full-stack app:

- **backend/** — Node.js + Express, speaks the Stalker "stb" portal protocol
  (handshake, auth, channel list, EPG, VOD, series, stream resolution), proxies
  HLS playback to avoid CORS issues, and caches EPG data in SQLite.
- **frontend/** — React + TypeScript (Vite), `hls.js` for playback.

## Features

- **Live TV** with a scrollable 24-hour EPG grid and live-now indicator. EPG
  loads lazily per row as it scrolls into view, and backfills further into the
  future on demand as you scroll the timeline ahead (e.g. to tonight's
  schedule)
- **Player tuned per content type** — live streams show resolution and
  framerate overlays and have no seek bar; VOD and series play with a seek bar
- **EPG cache** backed by SQLite — EPG is cached locally and reused for up to
  12 hours (configurable); coverage grows as newer data is fetched and merged,
  dramatically reducing portal requests
- **VOD** and **Series** browsing with category filtering and pagination
- **Saved profiles** — store portal URL + MAC + credentials under a name,
  switch between providers in one click; profiles are matched on both URL and
  MAC address so the same portal with different MACs is treated as separate.
  Each profile also remembers your sort order, selected category, and
  last-watched channel, all restored on reconnect
- **Favourites** — star channels for quick access, pinned to the top of the
  channel list; keyed by channel number + name so duplicate listings of the
  same channel are tracked independently
- **Backup** — export saved profiles and favourites to a JSON file and import
  them back, merging without creating duplicates
- **Resizable channel column** — drag the separator between the channel list
  and the EPG timeline; width persists across page reloads
- **Sort** channels by number or name
- Emulates a **MAG424** set-top box (metrics payload, SHA1 device fingerprint,
  correct `api_signature`) for broad portal compatibility
- **Resilient connect** — patient exponential backoff on HTTP 429 rate-limit
  responses rides out Cloudflare rate-limit windows during connect and stream
  resolution; URL-discovery probes stay patient on 429 but fail fast on
  wrong-path errors, so the correct API path is still found quickly
- **Playback-first request scheduling** — stream creation and auth run on a
  critical queue; EPG and catalogue calls run on a background queue that yields
  to critical work, so switching channels is never stuck behind EPG fetches
- **HLS proxy** rewrites playlists and segment/key URLs through the backend so
  the browser never needs CORS headers or special upstream authentication

## Requirements

- Node.js 18+ and npm
- A Stalker/Ministra portal URL, a registered device MAC address, and
  optionally a login/password — get these from your IPTV provider

## Setup

Install dependencies for both apps:

```bash
cd backend && npm install
cd ../frontend && npm install
```

Copy the env files (defaults work for local development). On macOS/Linux:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

On Windows (PowerShell):

```powershell
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
```

## Running

Start the backend (default port 4000):

```bash
cd backend
npm run dev
```

Start the frontend (default port 5173) in a second terminal:

```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and enter your portal details.

## Connecting

- **Portal URL** — e.g. `http://your-provider.com/c/` or the full API URL
  ending in `.php`. If you enter a bare host or base path, the backend probes
  the common API paths (`/portal.php`, `/stalker_portal/server/load.php`,
  `/server/load.php`, `/c/portal.php`, `/c/server/load.php`) automatically.
  Entering the exact URL avoids the probe requests, which matters for
  Cloudflare-protected portals with aggressive rate limits.
- **MAC Address** — the device MAC registered with your provider, e.g.
  `00:1A:79:00:00:00`
- **Login / Password** — only needed if your provider requires credential auth
  in addition to MAC-based auth
- **Save as profile** — give the connection a name to save it for one-click
  reconnect; stored in the browser's `localStorage`

## API overview

| Route | Description |
|---|---|
| `POST /api/connect` | Handshake, optional `do_auth`, `get_profile`; returns `sessionId` |
| `GET /api/genres` | Channel genre/category list |
| `GET /api/channels` | Full channel list with logos |
| `GET /api/epg/:channelId?limit=&refresh=` | Short EPG for one channel (cached; `refresh=1` re-fetches and merges to extend coverage) |
| `GET /api/stream?cmd=` | Resolve channel stream URL via `create_link` |
| `GET /api/vod/categories` | VOD category list |
| `GET /api/vod/list?categoryId=&page=&limit=` | VOD items |
| `GET /api/vod/stream?cmd=` | Resolve VOD stream URL |
| `GET /api/series/categories` | Series category list |
| `GET /api/series/list?categoryId=&page=&limit=` | Series items |
| `GET /api/series/episodes?seriesId=` | Episodes for a series |
| `GET /api/proxy/m3u8` | HLS playlist proxy with URL rewriting |
| `GET /api/proxy/segment` | HLS segment / key proxy |
| `GET /api/proxy/logo` | Channel logo proxy |

All requests after connect send the `sessionId` as the `X-Session-Id` header.
Sessions are in-memory and expire after 12 hours.

## Configuration

Backend environment variables (set in `backend/.env`):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | Backend server port |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated origins allowed to call the API |
| `EPG_STALENESS_HOURS` | `12` | How long EPG cache entries are considered fresh |
| `RATE_LIMIT_MAX_RETRIES` | `7` | Max HTTP 429 retry attempts (with exponential backoff) for connect/stream requests |

EPG cache is stored as a SQLite database at `data/epg-cache.db` (relative to
the project root, created automatically on first run).

## Notes

- Some portals return channel names set to the current event (common with
  sports/PPV tiers) — this is portal-side behaviour, not a display bug. Hover
  over a truncated name to see the full text.
- A few providers require specific `get_profile` parameters beyond the MAG424
  defaults; add portal-specific overrides in `backend/src/stalkerClient.ts` if
  needed.
