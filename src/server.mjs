/**
 * The local HTTP server: one page, static ES modules, and the JSON API the
 * views register in src/views/index.mjs. Decided in docs/architecture.md.
 *
 * It never spawns branchling and never touches a backlog file: every answer
 * comes from the adapter it is handed. That handed-in object is also the seam
 * for UI-2's cache: an object with `forRequest()` (what `servedFromCache` in
 * src/cache.mjs returns) is asked for a fresh adapter-shaped scope per
 * request, and the time of the answers that request read is sent as
 * `X-Branchling-UI-Fetched-At`. Handlers see envelopes either way.
 *
 * THE LOOPBACK GUARD. Binding to 127.0.0.1 is not enough on its own: any page
 * open in the same browser can reach a loopback port, and DNS rebinding makes
 * a foreign origin resolve to it. So, as `branchling serve` does:
 *   - every request must name this server in `Host` (127.0.0.1, localhost or
 *     [::1], with the bound port), or it is refused with 403;
 *   - every request that is not a GET must also carry an `Origin` equal to
 *     `http://<that Host>` and the per-process capability token injected into
 *     the served page, in the `X-Branchling-UI-Capability` header. Writing
 *     routes (UI-5's decide, UI-6) sit behind this check, never their own.
 *
 * REQUEST BODIES. A non-GET route gets its body parsed here, once, for every
 * route alike: `application/json` only, at most MAX_BODY_BYTES, handed to the
 * handler as `body`. It is read only after the guard has passed, so a foreign
 * page cannot make the server buffer anything.
 *
 * LIVE REFRESH (UI-7). `GET /api/events` is a server-sent events stream of
 * the live source handed in as `live` (src/live.mjs): `connected`,
 * `disconnected` and `change` events, and a comment line every
 * KEEPALIVE_MS so a proxy or the browser does not drop an idle stream. It is
 * a route of the server, not of the view registry, because a handler returns
 * one JSON body and this response never ends. It passes the same Host guard
 * as every request, and it is a GET, so it needs no capability: it carries
 * task ids and field names, nothing a write needs. A page of another origin
 * cannot read it: EventSource is subject to CORS, and this server sends no
 * Access-Control-Allow-Origin. Without `live` the route is a 404. Closing the
 * server closes the live source, and so its `follow` child.
 */

import { createServer as createHttpServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BranchlingRefusal, BranchlingUsageError, ContractMismatch } from "./adapter.mjs";
import { RequestError } from "./request-error.mjs";
import { views as defaultViews } from "./views/index.mjs";

/** One above `branchling serve`'s 4321, so both can run side by side. */
export const DEFAULT_PORT = 4322;
export const CAPABILITY_HEADER = "x-branchling-ui-capability";
export const FETCHED_AT_HEADER = "X-Branchling-UI-Fetched-At";
/** The largest request body a route accepts. A decision is a few hundred bytes. */
export const MAX_BODY_BYTES = 16 * 1024;
/** The path of the live refresh stream (UI-7). */
export const EVENTS_PATH = "/api/events";
/** How often an idle event stream gets a comment line (ms). */
export const KEEPALIVE_MS = 15_000;
/** How long the browser waits before reconnecting a dropped stream (ms). */
export const EVENTS_RETRY_MS = 2000;

const LOOPBACK_BIND = new Set(["127.0.0.1", "::1"]);
const SRC = fileURLToPath(new URL(".", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

/** The `Host` values this server answers to on `port`. */
export function allowedHosts(port) {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
}

/** True when `Host` names this server on its own port. */
export function isAllowedHost(host, port) {
  return allowedHosts(port).has(String(host || "").toLowerCase());
}

/** The write guard: allowed Host, matching Origin, and the capability token. */
export function isAllowedWrite(headers, port, token) {
  const host = String(headers.host || "").toLowerCase();
  if (!isAllowedHost(host, port)) return false;
  if (String(headers.origin || "").toLowerCase() !== `http://${host}`) return false;
  const given = Buffer.from(String(headers[CAPABILITY_HEADER] || ""));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The JSON error body for anything a handler throws. Never an empty result. */
export function errorBody(err) {
  if (err instanceof RequestError) {
    return { status: err.status, body: { error: { ...err.fields, type: err.type, message: err.message } } };
  }
  if (err instanceof BranchlingRefusal) {
    return { status: 409, body: { error: { type: "refusal", refusalKind: err.envelope.refusalKind ?? null, message: err.message, envelope: err.envelope } } };
  }
  if (err instanceof ContractMismatch) {
    return { status: 502, body: { error: { type: "contract-mismatch", message: err.message } } };
  }
  if (err instanceof BranchlingUsageError) {
    return { status: 500, body: { error: { type: "usage-error", message: err.message } } };
  }
  return { status: 500, body: { error: { type: "internal", message: String(err && err.message || err) } } };
}

function sendJson(res, status, body, extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...extra, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function refuse(res, status, type, message) {
  sendJson(res, status, { error: { type, message } });
}

/**
 * The JSON body of a non-GET request: `null` when there is none, the parsed
 * value otherwise. Anything else is a RequestError: a body that is not
 * `application/json` (415), larger than MAX_BODY_BYTES (413), or not JSON (400).
 */
export function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new RequestError(`The request body is larger than ${limit} bytes`, { status: 413, type: "payload-too-large" }));
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(new RequestError(`The request body is larger than ${limit} bytes`, { status: 413, type: "payload-too-large" }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", err => { if (!failed) { failed = true; reject(err); } });
    req.on("end", () => {
      if (failed) return;
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) { resolve(null); return; }
      const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (type !== "application/json") {
        reject(new RequestError("A request body must be sent as application/json", { status: 415, type: "unsupported-media-type" }));
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new RequestError("The request body is not valid JSON"));
      }
    });
  });
}

/**
 * One page's event stream: the live source's events as SSE, until the page
 * goes away. The event names are the `type` of src/live.mjs's events; the
 * data is the rest of the event as JSON.
 */
function serveEvents(req, res, live, keepAliveMs) {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": "text/event-stream; charset=utf-8",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`retry: ${EVENTS_RETRY_MS}\n\n`);
  const send = ({ type, ...data }) => {
    if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const keepAlive = setInterval(() => { if (!res.writableEnded) res.write(": keep-alive\n\n"); }, keepAliveMs);
  keepAlive.unref?.();
  const unsubscribe = live.subscribe(send);
  const stop = () => { clearInterval(keepAlive); unsubscribe(); };
  req.on("close", stop);
  res.on("close", stop);
}

/** Published path -> file, fixed at startup: nothing a request names is ever
 *  joined onto a directory, so there is no traversal to guard against. */
function staticFiles() {
  const files = new Map();
  for (const [prefix, dir] of [["/", join(SRC, "web")], ["/view-model/", join(SRC, "view-model")]]) {
    for (const name of readdirSync(dir)) {
      if (TYPES[extname(name)]) files.set(prefix + name, join(dir, name));
    }
  }
  return files;
}

function routeTable(views) {
  const table = new Map();
  for (const view of views) {
    for (const route of view.routes) {
      const key = `${route.method} ${route.path}`;
      if (table.has(key)) throw new Error(`two views register ${key}`);
      table.set(key, route.handler);
    }
  }
  return table;
}

function listenOnce(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = err => { server.off("listening", onListening); reject(err); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

/**
 * Starts the server. Resolves once it listens.
 *
 * @param {object} options
 * @param {object} options.adapter what createAdapter() returns, or anything
 *   with the same methods (UI-2's cache, a test double)
 * @param {number} [options.port] preferred port; 0 lets the system pick
 * @param {string} [options.host] "127.0.0.1" (default) or "::1"; nothing else
 * @param {number} [options.attempts] ports tried upward from `port` before
 *   falling back to one the system picks
 * @param {object} [options.live] the live source (src/live.mjs createLive)
 *   behind GET /api/events; the server owns it from here and closes it
 * @param {number} [options.keepAliveMs] the event stream's comment cadence
 * @param {(line: string) => void} [options.log] where server-side faults go
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export async function createServer({ adapter, live = null, port = DEFAULT_PORT, host = "127.0.0.1", attempts = 10, views = defaultViews, keepAliveMs = KEEPALIVE_MS, log = line => console.error(line) } = {}) {
  if (!adapter) throw new TypeError("createServer needs an adapter");
  if (!LOOPBACK_BIND.has(host)) throw new Error(`refusing to bind ${host}: only 127.0.0.1 or ::1`);

  const token = randomBytes(32).toString("base64url");
  const routes = routeTable(views);
  const files = staticFiles();
  let boundPort = 0;

  const server = createHttpServer(async (req, res) => {
    try {
      if (!isAllowedHost(req.headers.host, boundPort)) {
        refuse(res, 403, "forbidden", "The Host header does not name this local server");
        return;
      }
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method !== "GET" && !isAllowedWrite(req.headers, boundPort, token)) {
        refuse(res, 403, "forbidden", "A write needs a same-origin page and its capability token");
        return;
      }

      if (live && req.method === "GET" && url.pathname === EVENTS_PATH) {
        serveEvents(req, res, live, keepAliveMs);
        return;
      }

      const handler = routes.get(`${req.method} ${url.pathname}`);
      if (handler) {
        // One scope per request, so two requests in flight can never mix up
        // whose answer was how old.
        const scope = typeof adapter.forRequest === "function" ? adapter.forRequest() : { adapter, answeredAt: () => null };
        let body;
        try {
          const requestBody = req.method === "GET" ? undefined : await readJsonBody(req);
          body = await handler({ adapter: scope.adapter, req, url, params: url.searchParams, body: requestBody });
        } catch (err) {
          const { status, body: errBody } = errorBody(err);
          if (status >= 500) log(`branchling-ui: ${req.method} ${url.pathname}: ${err.message}`);
          // An oversized body was left unread: do not keep the connection for another request.
          if (status === 413) res.setHeader("Connection", "close");
          sendJson(res, status, errBody);
          if (status === 413) res.on("finish", () => req.destroy());
          return;
        }
        // A cache hit is NOT stale: UI-2's cache answers from memory only when
        // nothing changed since the answer was computed, so it never sets
        // X-Branchling-UI-Stale. That header is for a remembered answer served
        // while a fresh read is on its way, which nothing does yet.
        const at = scope.answeredAt();
        sendJson(res, 200, body, at === null ? {} : { [FETCHED_AT_HEADER]: new Date(at).toISOString() });
        return;
      }

      if (req.method !== "GET") {
        refuse(res, 405, "method-not-allowed", `${req.method} ${url.pathname} is not a route`);
        return;
      }
      const path = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = files.get(path);
      if (!file) {
        refuse(res, 404, "not-found", `${url.pathname} is not here`);
        return;
      }
      let content = readFileSync(file);
      if (path === "/index.html") {
        // A meta tag rather than an inline script, so the CSP can forbid inline scripts.
        content = content.toString("utf8").replace("</head>", `<meta name="branchling-ui-capability" content="${token}">\n</head>`);
      }
      res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": TYPES[extname(file)] });
      res.end(content);
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, errorBody(err).body);
      else res.end();
    }
  });

  // A port already in use must not stop startup: walk upward, then let the
  // system pick one.
  let candidate = port;
  for (let left = attempts; ; left--) {
    try {
      await listenOnce(server, candidate, host);
      break;
    } catch (err) {
      if (err.code !== "EADDRINUSE") throw err;
      candidate = left > 1 && candidate !== 0 && candidate < 65535 ? candidate + 1 : 0;
    }
  }
  boundPort = server.address().port;

  const urlHost = host === "::1" ? "[::1]" : host;
  return {
    url: `http://${urlHost}:${boundPort}/`,
    port: boundPort,
    close: async () => {
      const closed = new Promise((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
        server.closeAllConnections?.();
      });
      // The follow child goes with the server, never as an orphan.
      await Promise.all([closed, live ? live.close() : null]);
    },
  };
}
