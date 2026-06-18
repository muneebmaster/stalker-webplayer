import { Router } from "express";
import axios from "axios";
import { RateLimitError, StalkerClient } from "../stalkerClient.js";
import { createSession, getSession, destroySession, SessionError } from "../sessionStore.js";
import { epgCacheGet, epgCacheSet } from "../epgCache.js";
import type { StalkerCredentials } from "../types.js";

const router = Router();

// Common locations for the Stalker/Ministra "load.php" API endpoint, tried
// in order when the user supplies a bare host instead of a full API URL.
const CANDIDATE_PATHS = [
  "/portal.php",
  "/stalker_portal/server/load.php",
  "/server/load.php",
  "/c/portal.php",
  "/c/server/load.php",
];

function buildCandidateUrls(input: string): string[] {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (/\.php(\?.*)?$/i.test(trimmed)) {
    return [trimmed];
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  } catch {
    return CANDIDATE_PATHS.map((path) => `${trimmed}${path}`);
  }

  const origin = `${url.protocol}//${url.host}`;

  // Users often paste the URL of the web-based portal page (e.g.
  // ".../stalker_portal/c/" or ".../c/index.html") rather than the API
  // endpoint. Strip that trailing "client" segment to recover the portal's
  // base path (e.g. "/stalker_portal") so we can also try candidates there.
  let basePath = url.pathname.replace(/\/+$/, "");
  basePath = basePath.replace(/\/c(\/index\.html)?$/i, "");
  basePath = basePath.replace(/\/index\.html$/i, "");

  const roots = [origin];
  if (basePath && `${origin}${basePath}` !== origin) {
    roots.push(`${origin}${basePath}`);
  }

  const candidates: string[] = [];
  for (const root of roots) {
    for (const path of CANDIDATE_PATHS) {
      candidates.push(`${root}${path}`);
    }
  }
  return [...new Set(candidates)];
}

function getSessionId(req: { header: (name: string) => string | undefined; query: Record<string, unknown> }): string | undefined {
  return req.header("x-session-id") ?? (req.query.sessionId as string | undefined);
}

router.post("/connect", async (req, res) => {
  const { portalUrl, mac, login, password, serialNumber, deviceId, deviceId2 } =
    req.body as Partial<StalkerCredentials>;

  if (!portalUrl || !mac) {
    res.status(400).json({ error: "portalUrl and mac are required." });
    return;
  }
  if (!/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(mac)) {
    res.status(400).json({ error: "mac must look like 00:1A:79:00:00:00." });
    return;
  }

  const candidates = buildCandidateUrls(portalUrl);
  let lastError: Error | null = null;
  let client: StalkerClient | null = null;
  let matchedUrl: string | null = null;

  // Stage 1: find a candidate that responds to handshake (one cheap request
  // per candidate). We avoid running the full verification flow against
  // every candidate, since that can look like path-scanning to a portal's
  // WAF/anti-abuse layer and trigger a temporary block.
  for (const [index, candidate] of candidates.entries()) {
    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    const credentials: StalkerCredentials = {
      portalUrl: candidate,
      mac,
      login,
      password,
      serialNumber,
      deviceId,
      deviceId2,
    };
    const candidateClient = new StalkerClient(credentials);
    try {
      await candidateClient.handshake(true); // probe=true: no 429 retries
      client = candidateClient;
      matchedUrl = candidate;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (err instanceof RateLimitError) break;
    }
  }

  if (!client || !matchedUrl) {
    if (lastError instanceof RateLimitError) {
      res.status(429).json({ error: lastError.message });
      return;
    }
    res.status(502).json({
      error:
        `Could not connect to the portal. ${lastError?.message ?? ""}`.trim() +
        (candidates.length > 1
          ? ` Tried: ${candidates.join(", ")}. If you know the exact API URL, enter it directly (it should end in .php).`
          : ""),
    });
    return;
  }

  // Stage 2: fully verify and establish the session on the matched candidate.
  try {
    if (login && password) {
      await client.authenticate();
    }
    const profile = await client.getProfile();
    const accountInfo = await client.getAccountInfo();
    // Confirm this candidate actually serves itv content, not just the
    // handshake/profile actions, before committing to it.
    await client.getGenres();

    const credentials: StalkerCredentials = {
      portalUrl: matchedUrl,
      mac,
      login,
      password,
      serialNumber,
      deviceId,
      deviceId2,
    };
    // Reuse the already-handshaken/verified client: a fresh StalkerClient
    // would need its own handshake + get_profile before the portal accepts
    // itv actions, and skipping get_profile leads to "Authorization failed."
    const { sessionId } = createSession(client, credentials);
    res.json({ sessionId, portalUrl: matchedUrl, mac, profile, accountInfo });
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.status(429).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({
      error: `Connected to ${matchedUrl}, but channel data could not be loaded. ${message}`,
    });
  }
});

router.post("/disconnect", (req, res) => {
  const sessionId = getSessionId(req);
  if (sessionId) destroySession(sessionId);
  res.json({ ok: true });
});

router.get("/genres", async (req, res) => {
  try {
    const client = getSession(getSessionId(req));
    const genres = await client.getGenres();
    res.json({ genres });
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/channels", async (req, res) => {
  try {
    const client = getSession(getSessionId(req));
    const channels = await client.getAllChannels();
    const withLogos = channels.map((c) => ({
      ...c,
      logo: client.resolveLogoUrl(c.logo),
    }));
    res.json({ channels: withLogos });
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/epg/:channelId", async (req, res) => {
  try {
    const client = getSession(getSessionId(req));
    const channelId = req.params.channelId;
    const limit = req.query.limit ? Number(req.query.limit) : 8;

    const cached = epgCacheGet(client.portalHost, channelId);
    if (cached) {
      res.json({ programs: cached });
      return;
    }

    const programs = await client.getShortEpg(channelId, limit);
    if (programs.length > 0) {
      epgCacheSet(client.portalHost, channelId, programs);
    }
    res.json({ programs });
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/stream", async (req, res) => {
  try {
    const client = getSession(getSessionId(req));
    const cmd = req.query.cmd as string | undefined;
    if (!cmd) {
      res.status(400).json({ error: "cmd query parameter is required." });
      return;
    }
    const url = await client.createLink(cmd);
    res.json({ url, proxyUrl: `/api/proxy/m3u8?url=${encodeURIComponent(url)}` });
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/vod/categories", async (req, res) => {
  try {
    const client = getSession(getSessionId(req));
    const categories = await client.getVodCategories();
    res.json({ categories });
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/vod/list", async (req, res) => {
  try {
    const client = getSession(getSessionId(req));
    const categoryId = (req.query.categoryId as string) ?? "*";
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 48;
    const result = await client.getVodList(categoryId, page, limit);
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/vod/stream", async (req, res) => {
  try {
    const client = getSession(getSessionId(req));
    const cmd = req.query.cmd as string | undefined;
    const movieId = req.query.movieId as string | undefined;
    if (!cmd) {
      res.status(400).json({ error: "cmd query parameter is required." });
      return;
    }
    const url = await client.createVodLink(cmd, movieId);
    if (!url) {
      res.status(502).json({ error: "Portal did not return a stream URL for this title. The content may not be available on your subscription." });
      return;
    }
    const streamType = await resolveStreamType(url);
    const proxyUrl = streamType === "direct"
      ? `/api/proxy/segment?url=${encodeURIComponent(url)}`
      : `/api/proxy/m3u8?url=${encodeURIComponent(url)}`;
    res.json({ url, proxyUrl, streamType });
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/series/categories", async (req, res) => {
  try {
    const client = getSession(getSessionId(req));
    const categories = await client.getSeriesCategories();
    res.json({ categories });
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/series/episodes", async (req, res) => {
  try {
    const client = getSession(getSessionId(req));
    const seriesId = req.query.seriesId as string | undefined;
    if (!seriesId) {
      res.status(400).json({ error: "seriesId query parameter is required." });
      return;
    }
    const episodes = await client.getSeriesEpisodes(seriesId);
    res.json({ episodes });
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/series/list", async (req, res) => {
  try {
    const client = getSession(getSessionId(req));
    const categoryId = (req.query.categoryId as string) ?? "*";
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 48;
    const result = await client.getSeriesList(categoryId, page, limit);
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
});

const DIRECT_EXT_RE = /\.(mp4|mkv|avi|mov|wmv|flv|ts|webm|mpg|mpeg|m2ts|m4v|vob)(\?|$)/i;
const HLS_EXT_RE    = /\.m3u8(\?|$)/i;
const DIRECT_CT_RE  = /^(video\/|application\/octet-stream)/i;

async function resolveStreamType(url: string): Promise<"hls" | "direct"> {
  if (HLS_EXT_RE.test(url))    return "hls";
  if (DIRECT_EXT_RE.test(url)) return "direct";
  // No recognisable extension — sniff via HEAD to avoid handing a raw video
  // file to hls.js, which would report manifestLoadError trying to parse it.
  try {
    const head = await axios.head(url, {
      timeout: 5000,
      validateStatus: () => true,
      maxRedirects: 5,
      headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" },
    });
    const ct = String(head.headers["content-type"] ?? "");
    if (DIRECT_CT_RE.test(ct)) return "direct";
  } catch { /* network error — fall through to HLS assumption */ }
  return "hls";
}

function handleError(err: unknown, res: import("express").Response): void {
  if (err instanceof SessionError) {
    res.status(401).json({ error: err.message });
    return;
  }
  if (err instanceof RateLimitError) {
    res.status(429).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  res.status(502).json({ error: message });
}

export default router;
