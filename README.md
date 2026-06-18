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

- **Live TV** with a scrollable 6-hour EPG grid, live-now indicator, and lazy
  EPG loading per row as it scrolls into view
- **EPG cache** backed by SQLite — EPG data is cached locally and reused for
  up to 12 hours (configurable), dramatically reducing portal requests
- **VOD** and **Series** browsing with category filtering and pagination
- **Saved profiles** — store portal URL + MAC + credentials under a name,
  switch between providers in one click; profiles are matched on both URL and
  MAC address so the same portal with different MACs is treated as separate
- **Favourites** — star channels for quick access; pinned to the top of the
  channel list
- **Resizable channel column** — drag the separator between the channel list
  and the EPG timeline; width persists across page reloads
- **Sort** channels by number or name
- Emulates a **MAG424** set-top box (metrics payload, SHA1 device fingerprint,
  correct `api_signature`) for broad portal compatibility
- **Exponential backoff** on HTTP 429 rate-limit responses, with a separate
  fast-fail probe mode during initial URL discovery to avoid hammering
  Cloudflare-protected portals
- Two-queue request scheduling: stream creation (latency-sensitive) runs on a
  critical queue; EPG and catalogue calls run on a background queue, so
  switching channels is never delayed by an in-flight EPG fetch
- **HLS proxy** rewrites playlists and segment/key URLs through the backend so
  the browser never needs CORS headers or special upstream authentication

## Requirements

- Node.js 18+ and npm
- A Stalker/Ministra portal URL, a registered device MAC address, and
  optionally a login/password — get these from your IPTV provider

## Setup

```powershell
cd backend && npm install
cd ../frontend && npm install
```

Copy the env files (defaults work for local development):

```powershell
cd ../backend
copy .env.example .env
cd ../frontend
copy .env.example .env
```

## Running

Start the backend (default port 4000):

```powershell
cd backend
npm run dev
```

Start the frontend (default port 5173):

```powershell
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
| `GET /api/epg/:channelId` | Short EPG for one channel (cached) |
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
| `EPG_STALENESS_HOURS` | `12` | How long EPG cache entries are considered fresh |

EPG cache is stored as a SQLite database at `data/epg-cache.db` (relative to
the project root, created automatically on first run).

## Notes

- Some portals return channel names set to the current event (common with
  sports/PPV tiers) — this is portal-side behaviour, not a display bug. Hover
  over a truncated name to see the full text.
- A few providers require specific `get_profile` parameters beyond the MAG424
  defaults; add portal-specific overrides in `backend/src/stalkerClient.ts` if
  needed.
