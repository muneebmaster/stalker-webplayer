import { Router } from "express";
import axios, { AxiosResponse } from "axios";

const router = Router();

const STREAM_USER_AGENT =
  "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 250 Mobile Safari/533.3";

// Transient upstream failures (CDN hiccups, load-balancer blips) on the first
// manifest fetch are a common cause of hls.js "manifestLoadError" right after a
// channel switch. Retry the manifest fetch a few times with short backoff so
// these never reach the player.
const MANIFEST_MAX_RETRIES = 3;
const RETRY_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Server-side errors and throttling are worth retrying; 4xx (bad URL/auth) is not. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

/** Fetch an HLS manifest, retrying transient network errors / 5xx responses. */
async function fetchManifest(target: string): Promise<AxiosResponse<string>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MANIFEST_MAX_RETRIES; attempt++) {
    try {
      const upstream = await axios.get<string>(target, {
        responseType: "text",
        timeout: 20000,
        headers: { "User-Agent": STREAM_USER_AGENT, Accept: "*/*" },
        validateStatus: () => true,
      });
      if (isRetryableStatus(upstream.status) && attempt < MANIFEST_MAX_RETRIES) {
        console.log(`[proxy/m3u8] ${upstream.status} (attempt ${attempt + 1}/${MANIFEST_MAX_RETRIES + 1}) — retrying ${target.slice(0, 120)}`);
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      return upstream;
    } catch (err) {
      lastErr = err;
      if (attempt < MANIFEST_MAX_RETRIES) {
        console.log(`[proxy/m3u8] error (attempt ${attempt + 1}/${MANIFEST_MAX_RETRIES + 1}) — retrying: ${err instanceof Error ? err.message : String(err)}`);
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
    }
  }
  throw lastErr;
}

function proxiedUrl(req: import("express").Request, kind: "m3u8" | "segment", target: string): string {
  const base = `${req.protocol}://${req.get("host")}`;
  return `${base}/api/proxy/${kind}?url=${encodeURIComponent(target)}`;
}

function rewriteUri(req: import("express").Request, base: URL, uri: string): string {
  const absolute = new URL(uri, base).toString();
  const kind = /\.m3u8(\?|$)/i.test(absolute) ? "m3u8" : "segment";
  return proxiedUrl(req, kind, absolute);
}

/**
 * Fetches an HLS playlist (master or media) and rewrites every referenced
 * URI (segments, variant playlists, encryption keys, map tags) to route
 * back through this proxy, so the browser never needs direct/CORS access
 * to the upstream streaming host.
 */
router.get("/m3u8", async (req, res) => {
  const target = req.query.url as string | undefined;
  if (!target) {
    res.status(400).send("Missing url parameter");
    return;
  }

  try {
    const upstream = await fetchManifest(target);

    if (upstream.status >= 400) {
      console.log(`[proxy/m3u8] ${upstream.status} <- ${target.slice(0, 200)}`);
      res.status(upstream.status).send(upstream.data);
      return;
    }

    // Rewrite relative to the final URL (after any redirects), so segment and
    // variant URIs resolve correctly even when the manifest redirects hosts.
    const finalUrl: string = upstream.request?.res?.responseUrl ?? target;
    const base = new URL(finalUrl);
    const rewritten = upstream.data
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        if (trimmed.startsWith("#")) {
          // Rewrite URI="..." attributes used by EXT-X-KEY / EXT-X-MAP / etc.
          return trimmed.replace(/URI="([^"]+)"/i, (_m, uri) => `URI="${rewriteUri(req, base, uri)}"`);
        }

        // A plain line is either a media segment or a variant playlist URI.
        return rewriteUri(req, base, trimmed);
      })
      .join("\n");

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-store");
    res.send(rewritten);
  } catch (err) {
    res.status(502).send(err instanceof Error ? err.message : String(err));
  }
});

/** Streams a single media segment, encryption key, or direct video file through the proxy. */
router.get("/segment", async (req, res) => {
  const target = req.query.url as string | undefined;
  if (!target) {
    res.status(400).send("Missing url parameter");
    return;
  }

  try {
    // Forward Range header so direct MP4 files support seeking.
    const upstreamHeaders: Record<string, string> = {
      "User-Agent": STREAM_USER_AGENT,
      Accept: "*/*",
    };
    const rangeHeader = req.headers["range"];
    if (rangeHeader) upstreamHeaders["Range"] = rangeHeader;

    const upstream = await axios.get(target, {
      responseType: "stream",
      timeout: 20000,
      headers: upstreamHeaders,
      validateStatus: () => true,
    });

    res.status(upstream.status);
    const ct = upstream.headers["content-type"];
    const cl = upstream.headers["content-length"];
    const cr = upstream.headers["content-range"];
    const ar = upstream.headers["accept-ranges"];
    if (ct) res.setHeader("Content-Type", String(ct));
    if (cl) res.setHeader("Content-Length", String(cl));
    if (cr) res.setHeader("Content-Range", String(cr));
    if (ar) res.setHeader("Accept-Ranges", String(ar));
    res.setHeader("Cache-Control", "no-store");

    upstream.data.pipe(res);
  } catch (err) {
    res.status(502).send(err instanceof Error ? err.message : String(err));
  }
});

/** Proxies channel logos so the browser isn't blocked by the portal's CORS policy. */
router.get("/logo", async (req, res) => {
  const target = req.query.url as string | undefined;
  if (!target) {
    res.status(400).send("Missing url parameter");
    return;
  }

  try {
    const upstream = await axios.get(target, {
      responseType: "stream",
      timeout: 10000,
      headers: { "User-Agent": STREAM_USER_AGENT, Accept: "*/*" },
      validateStatus: () => true,
    });

    res.status(upstream.status);
    const contentType = upstream.headers["content-type"];
    if (contentType) res.setHeader("Content-Type", String(contentType));
    res.setHeader("Cache-Control", "public, max-age=3600");
    upstream.data.pipe(res);
  } catch {
    res.status(404).end();
  }
});

export default router;
