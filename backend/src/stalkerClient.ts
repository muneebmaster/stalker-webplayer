import axios, { AxiosInstance } from "axios";
import crypto from "crypto";
import type {
  Channel,
  EpgProgram,
  Genre,
  SeriesEpisode,
  SeriesItem,
  StalkerCredentials,
  StalkerProfile,
  VodCategory,
  VodItem,
} from "./types.js";

const USER_AGENT =
  "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";

// Rate-limit (HTTP 429) retry budgets. Critical work (connect handshake/auth
// and stream creation) is retried patiently so a transient Cloudflare
// rate-limit window — which can last tens of seconds — is ridden out rather
// than surfaced to the user as a connect failure. Background work (EPG,
// catalogue) retries only a little so a backlog never piles up behind it.
const MAX_RATE_LIMIT_RETRIES_CRITICAL = Number(process.env.RATE_LIMIT_MAX_RETRIES ?? 7);
const MAX_RATE_LIMIT_RETRIES_BACKGROUND = 2;
const MAX_AUTH_RETRIES = 1;

// Re-authenticate only for specific type.action pairs where js:false means
// the session token is genuinely stale, not just that the feature is unsupported.
// vod.create_link and series.create_link returning js:false means the portal
// doesn't route VOD through that type — not a token problem. Re-authing there
// fires 3 extra requests (handshake + do_auth + get_profile) and can trigger
// rate limiting on portals like TipTop that have Cloudflare protection.
const REAUTH_ELIGIBLE_KEYS = new Set(["itv.create_link", "itv.get_ordered_list"]);

/** Thrown when the portal responds with HTTP 429 after retries are exhausted. */
export class RateLimitError extends Error {}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(maxMs: number): number {
  return Math.floor(Math.random() * maxMs);
}

function exponentialBackoffMs(attempt: number): number {
  // 1s, 2s, 4s, 8s, 15s… — cap at 15s, plus up to 1s of jitter. Across the
  // critical retry budget this rides out a rate-limit window of ~1 minute.
  return Math.min(15000, 1000 * Math.pow(2, attempt)) + jitter(1000);
}

function deriveSerial(mac: string): string {
  return crypto
    .createHash("sha1")
    .update(mac)
    .digest("hex")
    .slice(0, 13)
    .toUpperCase();
}

/**
 * Minimal client for the Stalker / Ministra middleware "stb" portal API,
 * emulating a MAG250 set-top box well enough for handshake, channel
 * listing, EPG and stream resolution on most portals.
 */
// Minimum gap between consecutive requests to the same portal. Several
// portals appear to flag rapid back-to-back API calls as bot-like behaviour
// and return a misleading "Authorization failed" page for the later call.
const MIN_REQUEST_INTERVAL_MS = 350;

export class StalkerClient {
  private readonly http: AxiosInstance;
  private readonly mac: string;
  private readonly deviceId: string;
  private readonly deviceId2: string;
  private readonly serial: string;
  private readonly hwVersion2: string;
  private readonly metricsRandom: string;
  private token: string | null = null;
  private tokenIssuedAt = 0;
  // Single-flight guard for token acquisition (handshake / re-auth). Concurrent
  // callers that need a token while one acquisition is in flight await this same
  // promise instead of each starting their own — without it, a re-auth (which
  // nulls the token) makes every in-flight request fire its own handshake,
  // hammering the portal into a self-sustaining 429 rate-limit storm.
  private tokenOp: Promise<void> | null = null;
  private lastRequestAt = 0;
  // Absolute timestamp until which ALL requests from this client must wait.
  // Set when a 429 is received so queued calls don't immediately hammer the
  // portal the moment the backed-off call releases the queue lock.
  private rateLimitCooldownUntil = 0;
  // Critical queue: create_link, token ops — must never be blocked by EPG.
  private criticalQueue: Promise<void> = Promise.resolve();
  // Background queue: EPG, channel list, categories — runs independently.
  private backgroundQueue: Promise<void> = Promise.resolve();
  // Count of critical (playback/token) requests queued or in flight. Background
  // requests yield while this is > 0 so stream creation always wins the portal.
  private pendingCritical = 0;

  constructor(private readonly credentials: StalkerCredentials) {
    this.mac = credentials.mac;
    this.deviceId = credentials.deviceId?.trim() ?? "";
    this.deviceId2 = credentials.deviceId2?.trim() || this.deviceId;
    this.serial = credentials.serialNumber?.trim() || deriveSerial(this.mac);
    this.hwVersion2 = crypto.createHash("sha1").update(this.mac + this.serial).digest("hex");
    this.metricsRandom = crypto.randomBytes(16).toString("hex");
    this.http = axios.create({
      timeout: 15000,
      validateStatus: () => true,
    });
  }

  /** Portal "c/" client page, used as the Referer/Referrer header value. */
  private get referer(): string {
    try {
      const portal = new URL(this.credentials.portalUrl);
      const base = portal.pathname.replace(/\/(server\/load|portal)\.php$/i, "");
      return `${portal.protocol}//${portal.host}${base}/c/`;
    } catch {
      return "";
    }
  }

  private get baseHeaders(): Record<string, string> {
    const adid = crypto.createHash("md5").update(this.mac).digest("hex");
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "*/*",
      "X-User-Agent": "Model: MAG424; Link: WiFi",
      Cookie: `mac=${this.mac}; stb_lang=en; timezone=Europe/London; adid=${adid}`,
      Referer: this.referer,
      Referrer: this.referer,
      "Cache-Control": "no-cache",
      Connection: "Keep-Alive",
      "Accept-Encoding": "gzip",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  private get host(): string {
    try { return new URL(this.credentials.portalUrl).host; } catch { return this.credentials.portalUrl; }
  }

  private get origin(): string {
    try { const u = new URL(this.credentials.portalUrl); return `${u.protocol}//${u.host}`; }
    catch { return ""; }
  }

  get portalHost(): string { return this.host; }

  private log(msg: string): void {
    console.log(`[stalker] ${new Date().toISOString()} ${this.host} ${msg}`);
  }

  // ---------- Request queues + throttle ----------

  /** Critical queue: stream creation, token management. Never blocked by EPG. */
  private async call<T = unknown>(
    params: Record<string, string | number>
  ): Promise<T> {
    // Mark a critical request as pending immediately (even before it reaches
    // the head of its own queue) so in-flight background calls start yielding.
    this.pendingCritical++;
    const previous = this.criticalQueue;
    let release: () => void;
    this.criticalQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await this.executeCall<T>(params, 0, false);
    } finally {
      this.pendingCritical--;
      release!();
    }
  }

  /** Background queue: EPG, channel list, categories. Yields to critical work. */
  private async callBg<T = unknown>(
    params: Record<string, string | number>
  ): Promise<T> {
    const previous = this.backgroundQueue;
    let release: () => void;
    this.backgroundQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await this.executeCall<T>(params, 0, false, MAX_RATE_LIMIT_RETRIES_BACKGROUND, "background");
    } finally {
      release!();
    }
  }

  /**
   * Executes one portal call with throttle, rate-limit backoff, and
   * automatic re-authentication on token rejection.
   *
   * @param isReAuth  When true this call is part of an in-progress re-auth
   *                  sequence (prevents recursive re-auth loops).
   */
  private async executeCall<T = unknown>(
    params: Record<string, string | number>,
    attempt: number,
    isReAuth: boolean,
    maxRLRetries = MAX_RATE_LIMIT_RETRIES_CRITICAL,
    priority: "critical" | "background" = "critical"
  ): Promise<T> {
    // Playback takes absolute priority. A background call (EPG, catalogue)
    // never occupies the portal while a stream-creation or token request is
    // queued or in flight — it yields until the critical queue drains, so a
    // channel switch is never stuck behind a backlog of EPG fetches. At worst
    // a critical call waits on the single background request already in flight.
    if (priority === "background") {
      while (this.pendingCritical > 0) {
        await this.criticalQueue;
      }
    }

    // Respect the class-level rate-limit cooldown before throttle math.
    const cooldownWait = this.rateLimitCooldownUntil - Date.now();
    if (cooldownWait > 0) {
      this.log(`rate-limit cooldown: waiting ${cooldownWait}ms before ${params.type}.${params.action}`);
      await delay(cooldownWait);
    }

    const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestAt);
    if (wait > 0) await delay(wait);
    this.lastRequestAt = Date.now();

    const start = Date.now();
    const res = await this.http.get(this.credentials.portalUrl, {
      params: { JsHttpRequest: "1-xml", ...params },
      headers: this.baseHeaders,
    });

    const elapsed = Date.now() - start;
    const cfRay = res.headers["cf-ray"] ? ` cf-ray=${res.headers["cf-ray"]}` : "";
    const retryAfterHdr = res.headers["retry-after"] ? ` retry-after=${res.headers["retry-after"]}` : "";
    this.log(
      `${params.type}.${params.action} -> ${res.status} (${elapsed}ms, throttle_wait=${Math.max(wait, 0)}ms, attempt=${attempt})${cfRay}${retryAfterHdr}`
    );

    // ---- 429 Rate limiting ----
    if (res.status === 429) {
      if (attempt < maxRLRetries) {
        const retryAfterSec = Number(res.headers["retry-after"]);
        const backoffMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? Math.min(retryAfterSec * 1000, 30000)
          : exponentialBackoffMs(attempt);

        // Block ALL queued calls from this client until cooldown expires.
        this.rateLimitCooldownUntil = Date.now() + backoffMs;
        this.log(`429 on ${params.type}.${params.action} — backoff ${backoffMs}ms (attempt ${attempt + 1}/${maxRLRetries})`);
        await delay(backoffMs);
        return this.executeCall<T>(params, attempt + 1, isReAuth, maxRLRetries, priority);
      }

      const server = res.headers["server"];
      const cfRayVal = res.headers["cf-ray"];
      const bodySnippet = typeof res.data === "string"
        ? res.data.replace(/\s+/g, " ").trim().slice(0, 200) : "";
      const diagnostics = [
        server ? `server=${server}` : null,
        cfRayVal ? `cf-ray=${cfRayVal} (Cloudflare)` : null,
        res.headers["retry-after"] ? `retry-after=${res.headers["retry-after"]}` : null,
        bodySnippet ? `body="${bodySnippet}"` : null,
      ].filter(Boolean).join(", ");

      throw new RateLimitError(
        `The portal is temporarily rate-limiting requests (HTTP 429) and did not recover after ` +
        `${maxRLRetries} retries with exponential backoff (action "${params.action}"). ` +
        `This is usually Cloudflare protection — please wait a minute or two and try again.` +
        (diagnostics ? ` [${diagnostics}]` : "")
      );
    }

    if (res.status >= 400) {
      throw new Error(`Portal returned HTTP ${res.status} for action "${params.action}"`);
    }

    const body = res.data;

    // ---- "Authorization failed." — expired token returned as an HTML page ----
    // When the session token lapses mid-session the portal often replies with
    // an HTML "Authorization failed." page (HTTP 200, text/html) instead of a
    // JSON js:false response. Treat it the same: re-authenticate and retry so
    // the failure stays invisible to the user (e.g. on the next channel switch).
    if (typeof body === "string" && /authorization failed/i.test(body)) {
      const tokenAgeS = this.tokenIssuedAt ? Math.round((Date.now() - this.tokenIssuedAt) / 1000) : "never";
      this.log(
        `"Authorization failed" on ${params.type}.${params.action} ` +
        `(token age: ${tokenAgeS}s, isReAuth: ${isReAuth}, attempt: ${attempt})`
      );
      const retry = await this.maybeReauthAndRetry<T>(params, attempt, isReAuth, maxRLRetries, priority, "Authorization failed");
      if (retry.retried) return retry.value;
      throw new Error(
        `Portal rejected action "${params.action}" with "Authorization failed" (token age: ${tokenAgeS}s). ` +
        `The session token is no longer valid.`
      );
    }

    if (body == null || typeof body !== "object" || !("js" in body)) {
      const contentType = res.headers["content-type"];
      const bodySnippet = typeof body === "string"
        ? body.replace(/\s+/g, " ").trim().slice(0, 200)
        : JSON.stringify(body).slice(0, 200);
      throw new Error(
        `Portal returned an unexpected response for action "${params.action}". ` +
        `Check the portal URL is correct (it should point at load.php). ` +
        `[content-type=${contentType}, body="${bodySnippet}"]`
      );
    }

    // ---- js: false — token rejected by portal ----
    if (body.js === false || body.js === null) {
      const tokenAgeS = this.tokenIssuedAt ? Math.round((Date.now() - this.tokenIssuedAt) / 1000) : "never";
      this.log(
        `js=${JSON.stringify(body.js)} on ${params.type}.${params.action} ` +
        `(token age: ${tokenAgeS}s, isReAuth: ${isReAuth}, attempt: ${attempt})`
      );

      const retry = await this.maybeReauthAndRetry<T>(params, attempt, isReAuth, maxRLRetries, priority, `js=${JSON.stringify(body.js)}`);
      if (retry.retried) return retry.value;

      throw new Error(
        `Portal rejected action "${params.action}" (js: ${JSON.stringify(body.js)}, token age: ${tokenAgeS}s). ` +
        `This usually means the session token is no longer valid.`
      );
    }

    return (body as { js: T }).js;
  }

  /**
   * Transparently re-authenticate (handshake + get_profile) and retry the
   * original call when the portal rejects a stale token. Eligible only for
   * actions where a rejected token is a real problem (not feature-probe calls),
   * bounded by MAX_AUTH_RETRIES, and skipped while already re-authenticating.
   * Returns the retried result, or `{ retried: false }` if no retry was made.
   */
  private async maybeReauthAndRetry<T>(
    params: Record<string, string | number>,
    attempt: number,
    isReAuth: boolean,
    maxRLRetries: number,
    priority: "critical" | "background",
    trigger: string
  ): Promise<{ retried: true; value: T } | { retried: false }> {
    const reauthKey = `${params.type}.${params.action}`;
    if (isReAuth || !REAUTH_ELIGIBLE_KEYS.has(reauthKey) || attempt >= MAX_AUTH_RETRIES) {
      return { retried: false };
    }
    this.log(`${trigger} on ${reauthKey} — attempting re-authentication (handshake + get_profile)`);
    try {
      // Single-flight: concurrent rejected calls share one re-auth instead of
      // each running their own handshake (which caused the 429 storm).
      await this.acquireToken(() => this.reAuthDirect());
      this.log("Re-authentication succeeded — retrying original request");
      const value = await this.executeCall<T>(params, attempt + 1, false, maxRLRetries, priority);
      return { retried: true, value };
    } catch (reAuthErr) {
      this.log(`Re-authentication failed: ${reAuthErr instanceof Error ? reAuthErr.message : String(reAuthErr)}`);
      return { retried: false };
    }
  }

  /**
   * Re-authenticates by running handshake + get_profile directly (bypassing
   * the queue, since the caller already holds the queue lock).
   */
  private async reAuthDirect(): Promise<void> {
    // Force-expire the current token so baseHeaders doesn't send the stale one.
    this.token = null;
    this.tokenIssuedAt = 0;

    const handshakeJs = await this.executeCall<{ token: string }>(
      { type: "stb", action: "handshake", token: "" },
      0,
      true
    );
    if (!handshakeJs?.token) throw new Error("Re-handshake: portal did not return a token");
    this.token = handshakeJs.token;
    this.tokenIssuedAt = Date.now();

    // Re-run login if credentials were provided — some portals (e.g. TipTop)
    // require do_auth before they'll accept create_link, even after a fresh
    // handshake + get_profile.
    const { login, password } = this.credentials;
    if (login && password) {
      await this.executeCall(
        { type: "stb", action: "do_auth", login, password, device_id: this.deviceId, device_id2: this.deviceId2 },
        0,
        true
      );
    }

    // get_profile is required by most portals before they accept itv/vod actions.
    await this.executeCall(this.profileCallParams, 0, true);
  }

  private get profileCallParams(): Record<string, string | number> {
    const metrics = JSON.stringify({
      mac: this.mac,
      sn: this.serial,
      model: "MAG424",
      type: "STB",
      uid: "",
      random: this.metricsRandom,
    });
    return {
      type: "stb",
      action: "get_profile",
      hd: 1,
      ver: "ImageDescription: 2.20.02-pub-424; ImageDate: Fri May 8 15:39:55 UTC 2020; PORTAL version: 5.6.1; API Version: JS API version: 343; STB API version: 146; Player Engine version: 0x588",
      num_banks: 2,
      sn: this.serial,
      stb_type: "MAG424",
      client_type: "STB",
      image_version: 220,
      video_out: "hdmi",
      device_id: this.deviceId,
      device_id2: this.deviceId2,
      signature: "",
      auth_second_step: 0,
      hw_version: "1.7-BD-00",
      not_valid_token: 0,
      hw_version_2: this.hwVersion2,
      timestamp: Math.floor(Date.now() / 1000),
      api_signature: 262,
      metrics,
    };
  }

  // ---------- Public API ----------

  /** Performs the handshake to obtain (or refresh) the session token.
   *  Pass probe=true during candidate URL discovery to skip 429 retries. */
  async handshake(probe = false): Promise<void> {
    const params = { type: "stb", action: "handshake", token: "" } as const;
    // During URL discovery (probe) we bypass the queue but still ride out 429
    // rate-limiting with backoff. A wrong path returns a non-429 error (e.g.
    // 404) which is NOT retried, so the next candidate is tried immediately —
    // this prevents a transient rate-limit from being mistaken for the right
    // (or wrong) path.
    const js = probe
      ? await this.executeCall<{ token: string }>(params, 0, false, MAX_RATE_LIMIT_RETRIES_CRITICAL)
      : await this.call<{ token: string }>(params);
    if (!js?.token) {
      throw new Error("Handshake failed: portal did not return a token.");
    }
    this.token = js.token;
    this.tokenIssuedAt = Date.now();
  }

  /**
   * Run a token-acquisition operation under the single-flight lock. If one is
   * already in flight, await it instead of starting another. The lock is shared
   * by proactive refresh (ensureToken) and reactive re-auth so the two can
   * never overlap and stampede the portal with handshakes.
   */
  private acquireToken(op: () => Promise<void>): Promise<void> {
    if (!this.tokenOp) {
      this.tokenOp = op().finally(() => { this.tokenOp = null; });
    }
    return this.tokenOp;
  }

  private tokenIsFresh(): boolean {
    const TEN_MINUTES = 10 * 60 * 1000;
    return this.token !== null && Date.now() - this.tokenIssuedAt <= TEN_MINUTES;
  }

  private async ensureToken(): Promise<void> {
    if (this.tokenIsFresh()) return;
    await this.acquireToken(async () => {
      // Re-check inside the lock: a concurrent acquisition may have just
      // refreshed the token while we were waiting to enter.
      if (this.tokenIsFresh()) return;
      this.log(`Proactive session refresh (token age: ${Math.round((Date.now() - this.tokenIssuedAt) / 1000)}s)`);
      // Run the FULL re-establish (handshake + do_auth + get_profile), not a
      // bare handshake: this portal rejects itv.create_link with "Authorization
      // failed" on a handshake-only token until get_profile has been called.
      await this.reAuthDirect();
    });
  }

  /** Optional username/password login step, used by some providers. */
  async authenticate(): Promise<void> {
    await this.ensureToken();
    const { login, password } = this.credentials;
    if (!login || !password) return;

    await this.call({
      type: "stb",
      action: "do_auth",
      login,
      password,
      device_id: this.deviceId,
      device_id2: this.deviceId2,
    });
  }

  async getProfile(): Promise<StalkerProfile> {
    await this.ensureToken();
    const js = await this.call<StalkerProfile>(this.profileCallParams);
    const blockMsg = (js as Record<string, unknown> | null)?.block_msg;
    if (blockMsg) {
      const msg = (js as Record<string, unknown>).msg;
      throw new Error(
        `Portal rejected this device: ${[msg, blockMsg]
          .filter(Boolean)
          .map((s) => String(s).replace(/<br\s*\/?>/gi, " "))
          .join(" — ")}`
      );
    }
    return js;
  }

  async getAccountInfo(): Promise<Record<string, unknown> | null> {
    await this.ensureToken();
    try {
      return await this.call<Record<string, unknown>>({
        type: "account_info",
        action: "get_main_info",
      });
    } catch {
      return null;
    }
  }

  async getGenres(): Promise<Genre[]> {
    await this.ensureToken();
    const js = await this.callBg<Array<Record<string, unknown>>>({
      type: "itv",
      action: "get_genres",
    });
    return (js ?? []).map((g) => ({
      id: String(g.id),
      title: String(g.title ?? g.id),
      alias: g.alias ? String(g.alias) : undefined,
    }));
  }

  async getAllChannels(): Promise<Channel[]> {
    await this.ensureToken();
    const js = await this.callBg<{ data: Array<Record<string, unknown>> }>({
      type: "itv",
      action: "get_all_channels",
      force_ch_link_check: "",
    });
    return (js?.data ?? []).map((c) => ({
      id: String(c.id),
      name: String(c.name ?? ""),
      number: String(c.number ?? ""),
      logo: String(c.logo ?? ""),
      cmd: String(c.cmd ?? ""),
      genreId: String(c.tv_genre_id ?? ""),
      epgId: String(c.xmltv_id ?? c.id ?? ""),
      tvArchive: Number(c.enable_tv_archive ?? c.tv_archive ?? 0) === 1,
      tvArchiveDuration: Number(c.tv_archive_duration ?? 0),
    }));
  }

  async createLink(cmd: string): Promise<string> {
    await this.ensureToken();
    const js = await this.call<{ cmd: string }>({
      type: "itv",
      action: "create_link",
      cmd,
    });
    const resolved = js?.cmd ?? "";
    const match = resolved.match(/(https?:\/\/\S+)/);
    return match ? match[1] : resolved;
  }

  async getShortEpg(channelId: string, limit = 12): Promise<EpgProgram[]> {
    await this.ensureToken();
    const js = await this.callBg<Array<Record<string, unknown>>>({
      type: "itv",
      action: "get_short_epg",
      ch_id: channelId,
      size: limit,
    });
    return (js ?? []).map((p) => ({
      id: String(p.id ?? `${channelId}-${p.start_timestamp}`),
      channelId,
      name: String(p.name ?? "No information"),
      description: String(p.descr ?? ""),
      startTimestamp: Number(p.start_timestamp ?? 0) * 1000,
      stopTimestamp: Number(p.stop_timestamp ?? 0) * 1000,
    }));
  }

  async getVodCategories(): Promise<VodCategory[]> {
    await this.ensureToken();
    const js = await this.callBg<Array<Record<string, unknown>>>({
      type: "vod",
      action: "get_categories",
    });
    return (js ?? []).map((c) => ({
      id: String(c.id),
      title: String(c.title ?? c.id),
    }));
  }

  async getVodList(
    categoryId: string,
    page = 1,
    limit = 48
  ): Promise<{ items: VodItem[]; totalItems: number }> {
    await this.ensureToken();
    const js = await this.callBg<{
      total_items?: number;
      data?: Array<Record<string, unknown>>;
    }>({
      type: "vod",
      action: "get_ordered_list",
      category: categoryId,
      sortby: "added",
      p: page,
      rows: limit,
      force_ch_link_check: "",
    });
    const raw = js?.data ?? [];
    const items = raw.map((m) => ({
      id: String(m.id),
      name: String(m.name ?? m.o_name ?? ""),
      cmd: String(m.cmd ?? ""),
      categoryId,
      screenshot: this.resolveLogoUrl(String(m.screenshot_uri ?? m.poster ?? "")),
      description: String(m.description ?? ""),
      year: String(m.year ?? ""),
      duration: String(m.time ?? ""),
      director: String(m.director ?? ""),
      actors: String(m.actors ?? ""),
      rating: String(m.rating_imdb ?? m.rating_kinopoikov ?? ""),
    }));
    return { items, totalItems: Number(js?.total_items ?? items.length) };
  }

  async createVodLink(cmd: string, movieId?: string): Promise<string> {
    await this.ensureToken();
    this.log(`createVodLink: cmd=${cmd.slice(0, 120)}, movieId=${movieId ?? "none"}`);

    // The browse list returns simplified cmds (/media/567200.mpg using the movie id).
    // The per-movie get_ordered_list call returns the file-specific cmd
    // (/media/file_3193086.mpg using file_id) that vod.create_link actually needs.
    let resolvedCmd = cmd;
    if (movieId) {
      try {
        const detail = await this.callBg<{ data?: Array<Record<string, unknown>> }>({
          type: "vod", action: "get_ordered_list",
          movie_id: movieId, season_id: 0, episode_id: 0,
          category: "*", fav: 0, sortby: "added", hd: 0, not_ended: 0, p: 1,
        });
        const item = detail?.data?.[0];
        // data[] items are file records: id=file_id, video_id=movie_id.
        // Construct the file-path cmd the portal expects for create_link.
        const fileId = String(item?.id ?? "");
        if (fileId) {
          resolvedCmd = `/media/file_${fileId}.mpg`;
          this.log(`createVodLink: file_id=${fileId}, resolved cmd=${resolvedCmd}`);
        }
      } catch (err) {
        this.log(`createVodLink: detail fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    let resolved = "";
    try {
      const js = await this.call<Record<string, unknown>>({
        type: "vod",
        action: "create_link",
        cmd: resolvedCmd,
        series: "",
        forced_storage: "",
        disable_ad: 0,
        download: 0,
        force_ch_link_check: 0,
      });
      resolved = this.extractUrl(js);
      if (!resolved) this.log(`createVodLink (vod) no url: ${JSON.stringify(js).slice(0, 200)}`);
    } catch (err) {
      this.log(`createVodLink (vod) failed: ${err instanceof Error ? err.message : String(err)} — trying itv`);
    }

    if (!resolved) {
      const js = await this.call<Record<string, unknown>>({
        type: "itv",
        action: "create_link",
        cmd: resolvedCmd,
      });
      resolved = this.extractUrl(js);
      if (!resolved) this.log(`createVodLink (itv) no url: ${JSON.stringify(js).slice(0, 200)}`);
    }

    // Last resort: some portals serve media directly at the portal origin + cmd
    // path without needing create_link (e.g. cmd=/media/839371.mpg →
    // http://vueit.xyz/media/839371.mpg). Validate with HEAD first — if the
    // server returns 4xx the file isn't HTTP-accessible and we return "" so
    // the caller can surface a "content not available" error instead of sending
    // a broken URL to the player.
    if (!resolved && resolvedCmd.startsWith("/") && this.origin) {
      const directUrl = `${this.origin}${resolvedCmd}`;
      try {
        const head = await axios.head(directUrl, {
          timeout: 6000,
          validateStatus: () => true,
          headers: { "User-Agent": USER_AGENT },
        });
        if (head.status < 400) {
          resolved = directUrl;
          this.log(`createVodLink (direct path): ${resolved}`);
        } else {
          this.log(`createVodLink (direct path) HTTP ${head.status} — not accessible: ${directUrl}`);
        }
      } catch (err) {
        this.log(`createVodLink (direct path) HEAD failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return resolved;
  }

  private extractUrl(js: Record<string, unknown> | null | undefined): string {
    if (!js) return "";
    // Portals vary on which field holds the stream URL.
    const raw = String(js.cmd ?? js.url ?? js.mediaurl ?? js.media_url ?? "");
    const match = raw.match(/(https?:\/\/\S+)/);
    return match ? match[1] : raw;
  }

  async getSeriesCategories(): Promise<VodCategory[]> {
    await this.ensureToken();
    const js = await this.callBg<Array<Record<string, unknown>>>({
      type: "series",
      action: "get_categories",
    });
    return (js ?? []).map((c) => ({
      id: String(c.id),
      title: String(c.title ?? c.id),
    }));
  }

  async getSeriesList(
    categoryId: string,
    page = 1,
    limit = 48
  ): Promise<{ items: SeriesItem[]; totalItems: number }> {
    await this.ensureToken();
    const js = await this.callBg<{
      total_items?: number;
      data?: Array<Record<string, unknown>>;
    }>({
      type: "series",
      action: "get_ordered_list",
      category: categoryId,
      sortby: "added",
      p: page,
      rows: limit,
    });
    const items = (js?.data ?? []).map((s) => {
      const rawSeasons = s.series as Record<string, Array<Record<string, unknown>>> | undefined;
      const episodes: SeriesEpisode[] = [];
      if (rawSeasons && typeof rawSeasons === "object") {
        for (const [seasonNum, eps] of Object.entries(rawSeasons)) {
          if (Array.isArray(eps)) {
            for (const ep of eps) {
              episodes.push({
                id: String(ep.id ?? `${s.id}-s${seasonNum}-e${ep.series_no}`),
                seriesId: String(s.id),
                name: String(ep.name ?? ep.series_no ?? ""),
                season: Number(seasonNum),
                episode: Number(ep.series_no ?? 0),
                cmd: String(ep.cmd ?? ""),
              });
            }
          }
        }
      }
      return {
        id: String(s.id),
        name: String(s.name ?? s.o_name ?? ""),
        categoryId,
        screenshot: this.resolveLogoUrl(String(s.screenshot_uri ?? s.poster ?? "")),
        description: String(s.description ?? ""),
        year: String(s.year ?? ""),
        episodes,
      };
    });
    return { items, totalItems: Number(js?.total_items ?? items.length) };
  }

  async getSeriesEpisodes(seriesId: string): Promise<SeriesEpisode[]> {
    await this.ensureToken();
    const js = await this.callBg<{
      data?: Array<Record<string, unknown>>;
    }>({
      type: "series",
      action: "get_ordered_list",
      movie_id: seriesId,
      category: "*",
      sortby: "added",
      p: 1,
      rows: 1,
    });

    const item = js?.data?.[0];
    if (!item) return [];

    const rawSeasons = item.series as Record<string, Array<Record<string, unknown>>> | undefined;
    const episodes: SeriesEpisode[] = [];
    if (rawSeasons && typeof rawSeasons === "object") {
      for (const [seasonNum, eps] of Object.entries(rawSeasons)) {
        if (Array.isArray(eps)) {
          for (const ep of eps) {
            episodes.push({
              id: String(ep.id ?? `${seriesId}-s${seasonNum}-e${ep.series_no}`),
              seriesId,
              name: String(ep.name ?? ep.series_no ?? ""),
              season: Number(seasonNum),
              episode: Number(ep.series_no ?? 0),
              cmd: String(ep.cmd ?? ""),
            });
          }
        }
      }
    }
    return episodes;
  }

  /** Resolves a (possibly relative) logo path against the portal host. */
  resolveLogoUrl(logo: string): string {
    if (!logo) return "";
    if (/^https?:\/\//i.test(logo)) return logo;
    try {
      const portal = new URL(this.credentials.portalUrl);
      return new URL(logo, `${portal.protocol}//${portal.host}`).toString();
    } catch {
      return logo;
    }
  }
}
