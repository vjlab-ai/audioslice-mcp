// HTTP client for the AudioSlice control API.
//
// The only network this server ever touches is localhost. Documentation is
// baked into the bundle at build time rather than fetched, so a machine with no
// internet behaves identically to one with it.

import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const DEFAULT_PORT = 8722;

/** Where AudioSlice persists its settings, per platform. */
function settingsDir() {
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "AudioSlice");
  }
  if (platform() === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "AudioSlice");
  }
  return join(homedir(), ".config", "AudioSlice");
}

/**
 * Port resolution, in priority order:
 *   1. AUDIOSLICE_PORT (set from the bundle's user_config, if the user set one)
 *   2. the handshake file AudioSlice writes when its API starts
 *   3. the default
 *
 * The handshake exists so that a user who changes the port in Advanced settings
 * does not then have to reconfigure this server to match.
 */
function resolvePort() {
  const fromEnv = Number.parseInt(process.env.AUDIOSLICE_PORT || "", 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  try {
    const h = JSON.parse(readFileSync(join(settingsDir(), "mcp.json"), "utf8"));
    if (Number.isFinite(h.port) && h.port > 0) return h.port;
  } catch {
    // No handshake file - fall through to the default. Not an error: it only
    // exists once a build that writes it has run.
  }
  return DEFAULT_PORT;
}

export class AudioSliceClient {
  constructor() {
    this.port = resolvePort();
    this.token = process.env.AUDIOSLICE_TOKEN || "";
    // Serialises mutations and spaces them out. Every mutating endpoint parks
    // AudioSlice's output thread while it applies, so a burst of edits would
    // stall OSC repeatedly - potentially mid-show. Reads are unaffected and are
    // never queued.
    this.writeChain = Promise.resolve();
    this.minWriteGapMs = 120;
    this.lastWriteAt = 0;
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}/api/v1`;
  }

  setToken(token) {
    this.token = token || "";
  }

  headers() {
    const h = { "content-type": "application/json" };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    return h;
  }

  /** Turn transport failures into something a person can act on. */
  friendlyError(err) {
    const code = err?.cause?.code || err?.code;
    if (code === "ECONNREFUSED" || code === "ERR_SOCKET_CONNECTION_TIMEOUT") {
      return new Error(
        `Could not reach AudioSlice on 127.0.0.1:${this.port}. It is usually one of:\n` +
          `  - AudioSlice is not running. Launch it and try again.\n` +
          `  - Its HTTP API is switched off. Turn it on in Advanced settings.\n` +
          `  - It is on a different port. Check Advanced settings and set the port in this ` +
          `extension's configuration.`
      );
    }
    if (code === "ETIMEDOUT" || err?.name === "AbortError") {
      return new Error(
        `AudioSlice did not respond within 5s on port ${this.port}. It may be busy starting up, ` +
          `or wedged - check that its window is responsive.`
      );
    }
    return err;
  }

  async request(method, path, body) {
    const url = `${this.baseUrl}${path}`;
    const signal = AbortSignal.timeout(5000);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw this.friendlyError(err);
    }

    if (res.status === 401) {
      throw new Error(
        "AudioSlice rejected the request: it has an API token set and this extension does not " +
          "have it.\n\nAsk the user to open AudioSlice > Advanced settings, copy the API token, " +
          "and paste it here. Then call set_audioslice_token with it - it will be remembered " +
          "for future conversations."
      );
    }
    if (res.status === 404) {
      const text = await res.text().catch(() => "");
      throw new Error(`Not found: ${method} ${path}. ${text}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AudioSlice returned ${res.status} for ${method} ${path}. ${text}`);
    }
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  get(path) {
    return this.request("GET", path);
  }

  /**
   * Mutating call. Serialised against every other mutation and spaced by at
   * least minWriteGapMs, because each one briefly parks the output thread.
   */
  write(method, path, body) {
    const run = async () => {
      const since = Date.now() - this.lastWriteAt;
      if (since < this.minWriteGapMs) {
        await new Promise((r) => setTimeout(r, this.minWriteGapMs - since));
      }
      try {
        return await this.request(method, path, body);
      } finally {
        this.lastWriteAt = Date.now();
      }
    };
    // Chain regardless of whether the previous write settled, so one failure
    // does not wedge the queue.
    const result = this.writeChain.then(run, run);
    this.writeChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
