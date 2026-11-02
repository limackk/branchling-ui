/**
 * The local HTTP server: one page, static ES modules, and the JSON API the
 * views register in src/views/index.mjs. Decided in docs/architecture.md.
 *
 * It never spawns branchling and never touches a backlog file: every answer
 * comes from the adapter it is handed. That handed-in object is also the seam
 * for UI-2's cache, which will wrap the adapter with the same interface, so
 * nothing here changes when the cache arrives.
 *
 * THE LOOPBACK GUARD. Binding to 127.0.0.1 is not enough on its own: any page
 * open in the same browser can reach a loopback port, and DNS rebinding makes
 * a foreign origin resolve to it. So, as `branchling serve` does:
 *   - every request must name this server in `Host` (127.0.0.1, localhost or
 *     [::1], with the bound port), or it is refused with 403;
 *   - every request that is not a GET must also carry an `Origin` equal to
 *     `http://<that Host>` and the per-process capability token injected into
 *     the served page, in the `X-Branchling-UI-Capability` header. No route
 *     writes yet; UI-5 and UI-6 add writes behind this check, not their own.
 */

import { createServer as createHttpServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BranchlingRefusal, BranchlingUsageError, ContractMismatch } from "./adapter.mjs";
import { views as defaultViews } from "./views/index.mjs";

/** One above `branchling serve`'s 4321, so both can run side by side. */
export const DEFAULT_PORT = 4322;
export const CAPABILITY_HEADER = "x-branchling-ui-capability";

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

function sendJson(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function refuse(res, status, type, message) {
  sendJson(res, status, { error: { type, message } });
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
 * @param {(line: string) => void} [options.log] where server-side faults go
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export async function createServer({ adapter, port = DEFAULT_PORT, host = "127.0.0.1", attempts = 10, views = defaultViews, log = line => console.error(line) } = {}) {
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

      const handler = routes.get(`${req.method} ${url.pathname}`);
      if (handler) {
        let body;
        try {
          body = await handler({ adapter, req, url, params: url.searchParams });
        } catch (err) {
          const { status, body: errBody } = errorBody(err);
          if (status >= 500) log(`branchling-ui: ${req.method} ${url.pathname}: ${err.message}`);
          sendJson(res, status, errBody);
          return;
        }
        sendJson(res, 200, body);
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
    close: () => new Promise((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
      server.closeAllConnections?.();
    }),
  };
}
