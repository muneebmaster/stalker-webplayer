import { Router } from "express";
import axios from "axios";

const router = Router();

const STREAM_USER_AGENT =
  "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 250 Mobile Safari/533.3";

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
    const upstream = await axios.get<string>(target, {
      responseType: "text",
      timeout: 20000,
      headers: { "User-Agent": STREAM_USER_AGENT, Accept: "*/*" },
      validateStatus: () => true,
    });

    if (upstream.status >= 400) {
      console.log(`[proxy/m3u8] ${upstream.status} <- ${target.slice(0, 200)}`);
      res.status(upstream.status).send(upstream.data);
      return;
    }

    const base = new URL(target);
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
