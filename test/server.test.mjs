/**
 * The server skeleton against the REAL branchling executable over a fixture
 * backlog built in a temporary directory, as test/adapter.test.mjs builds it.
 * Requests go through node:http rather than fetch, because fetch will not let
 * a test set the Host header, and the Host header is what the guard judges.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { createAdapter, run, BranchlingRefusal } from "../src/adapter.mjs";
import { createCache, createFileChanges, servedFromCache } from "../src/cache.mjs";
import { RequestError } from "../src/request-error.mjs";
import { createServer, CAPABILITY_HEADER } from "../src/server.mjs";

const BIN = process.env.BRANCHLING_BIN || "branchling";
let root;
let dir;
let server;

async function branchling(args, opts) {
  const { code, stderr } = await run(BIN, args, { cwd: root, ...opts });
  assert.equal(code, 0, `branchling ${args.join(" ")} exited ${code}: ${stderr}`);
}

/** One request to `srv` with exactly these headers. */
function call(srv, { method = "GET", path = "/", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: srv.port, method, path, headers: { host: `127.0.0.1:${srv.port}`, ...headers } }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => {
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

before(async () => {
  root = mkdtempSync(join(tmpdir(), "branchling-ui-server-"));
  dir = join(root, "backlog");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  await branchling(["init", "--dir", dir, "--no-example", "--no-nudge"]);
  const body = JSON.stringify({
    goal: "A fixture task exists.",
    verification: [{ id: "noop", bash: "true", proves: "The fixture can be closed." }],
  });
  await branchling(["new", "--title", "Fixture task", "--priority", "P1", "--dir", dir], { input: body });
  server = await createServer({ adapter: createAdapter({ bin: BIN, dir, cwd: root }), port: 0 });
});

after(async () => {
  await server?.close();
  rmSync(root, { recursive: true, force: true });
});

test("the server listens on 127.0.0.1 and serves the page with its capability", async () => {
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const res = await call(server);
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /^text\/html/);
  assert.match(res.text, /<script type="module" src="\/app\.mjs">/);
  assert.match(res.text, /<meta name="branchling-ui-capability" content="[A-Za-z0-9_-]{43}">/);
  assert.match(res.headers["content-security-policy"], /script-src 'self'/);
});

test("the stats endpoint returns the adapter's stats envelope for the fixture", async () => {
  const res = await call(server, { path: "/api/stats" });
  assert.equal(res.status, 200);
  const direct = await createAdapter({ bin: BIN, dir, cwd: root }).stats();
  assert.equal(res.json.kind, "stats");
  assert.equal(res.json.schemaVersion, 1);
  assert.equal(res.json.stats.total, 1);
  assert.deepEqual(res.json.stats, direct.stats);
});

test("the page's script and the shared view model are served as ES modules", async () => {
  for (const path of ["/app.mjs", "/view-model/stats.mjs", "/view-model/states.mjs", "/view-model/roles.mjs"]) {
    const res = await call(server, { path });
    assert.equal(res.status, 200, path);
    assert.match(res.headers["content-type"], /^text\/javascript/, path);
  }
});

test("a path outside the published files is not found, traversal included", async () => {
  for (const path of ["/nope.mjs", "/../adapter.mjs", "/view-model/../server.mjs", "/%2e%2e/adapter.mjs"]) {
    const res = await call(server, { path });
    assert.equal(res.status, 404, path);
    assert.equal(res.json.error.type, "not-found", path);
  }
});

test("a loopback host with the server's port is answered", async () => {
  // Positive control for the refusal below.
  for (const host of [`127.0.0.1:${server.port}`, `localhost:${server.port}`, `[::1]:${server.port}`]) {
    const res = await call(server, { path: "/api/stats", headers: { host } });
    assert.equal(res.status, 200, host);
    assert.equal(res.json.kind, "stats", host);
  }
});

test("a foreign host header is refused before any route runs", async () => {
  for (const host of ["evil.example", `evil.example:${server.port}`, `127.0.0.1:${server.port + 1}`, "127.0.0.1", `localhost.evil.example:${server.port}`]) {
    for (const path of ["/", "/api/stats"]) {
      const res = await call(server, { path, headers: { host } });
      assert.equal(res.status, 403, `${host} ${path}`);
      assert.equal(res.json.error.type, "forbidden", `${host} ${path}`);
      assert.doesNotMatch(res.text, /branchling-ui-capability|"kind"/, `${host} ${path}`);
    }
  }
});

test("a write from a loopback host needs the matching origin and the capability token", async () => {
  const page = await call(server);
  const token = page.text.match(/name="branchling-ui-capability" content="([^"]+)"/)[1];
  const host = `127.0.0.1:${server.port}`;
  const origin = `http://${host}`;
  const post = headers => call(server, { method: "POST", path: "/api/stats", headers: { host, ...headers } });

  assert.equal((await post({ origin })).status, 403, "no token");
  assert.equal((await post({ origin, [CAPABILITY_HEADER]: "x".repeat(token.length) })).status, 403, "wrong token");
  assert.equal((await post({ origin: "http://evil.example", [CAPABILITY_HEADER]: token })).status, 403, "foreign origin");
  assert.equal((await post({ [CAPABILITY_HEADER]: token })).status, 403, "no origin");
  // Positive control: the guard lets this one through; there is simply no
  // writing route yet, so it ends as 405 rather than 403.
  const passed = await post({ origin, [CAPABILITY_HEADER]: token });
  assert.equal(passed.status, 405);
  assert.equal(passed.json.error.type, "method-not-allowed");
});

test("a port already in use moves the server to another one", async () => {
  const blocker = createNetServer();
  await new Promise(resolve => blocker.listen(0, "127.0.0.1", resolve));
  const taken = blocker.address().port;
  const moved = await createServer({ adapter: createAdapter({ bin: BIN, dir, cwd: root }), port: taken });
  try {
    assert.notEqual(moved.port, taken);
    const res = await call(moved, { path: "/api/stats" });
    assert.equal(res.status, 200);
  } finally {
    await moved.close();
    blocker.close();
  }
});

test("binding anything but loopback is refused", async () => {
  await assert.rejects(createServer({ adapter: {}, host: "0.0.0.0", port: 0 }), /only 127\.0\.0\.1 or ::1/);
});

test("a usage error from the real executable is a JSON error, not an empty result", async () => {
  const broken = await createServer({ adapter: createAdapter({ bin: BIN, dir: join(root, "no-backlog-here"), cwd: root }), port: 0, log: () => {} });
  try {
    const res = await call(broken, { path: "/api/stats" });
    assert.equal(res.status, 500);
    assert.equal(res.json.error.type, "usage-error");
    assert.equal(res.json.kind, undefined);
  } finally {
    await broken.close();
  }
});

test("an unsupported envelope is reported as a contract mismatch", async () => {
  const fake = join(root, process.platform === "win32" ? "fake-branchling.cmd" : "fake-branchling");
  const envelope = '{"schemaVersion": 99, "kind": "stats"}';
  if (process.platform === "win32") writeFileSync(fake, `@echo ${envelope}\r\n`);
  else writeFileSync(fake, `#!/bin/sh\necho '${envelope}'\n`);
  chmodSync(fake, 0o755);
  const mismatched = await createServer({ adapter: createAdapter({ bin: fake }), port: 0, log: () => {} });
  try {
    const res = await call(mismatched, { path: "/api/stats" });
    assert.equal(res.status, 502);
    assert.equal(res.json.error.type, "contract-mismatch");
  } finally {
    await mismatched.close();
  }
});

test("a refusal keeps its kind and envelope on the way to the page", async () => {
  const envelope = { schemaVersion: 1, kind: "stats", refusalKind: "example-refusal", refusal: "declined for the test" };
  const refusing = await createServer({ adapter: { stats: async () => { throw new BranchlingRefusal(envelope, 1); } }, port: 0 });
  try {
    const res = await call(refusing, { path: "/api/stats" });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.type, "refusal");
    assert.equal(res.json.error.refusalKind, "example-refusal");
    assert.equal(res.json.error.message, "declined for the test");
    assert.deepEqual(res.json.error.envelope, envelope);
  } finally {
    await refusing.close();
  }
});

test("a handler can answer 400 for a bad request without reaching the adapter", async () => {
  let reached = false;
  const views = [{ id: "probe", routes: [{ method: "GET", path: "/api/probe", handler: ({ adapter, params }) => {
    if (!params.get("q")) throw new RequestError("q is required");
    reached = true;
    return adapter.stats();
  } }] }];
  const probing = await createServer({ adapter: createAdapter({ bin: BIN, dir, cwd: root }), port: 0, views });
  try {
    const bad = await call(probing, { path: "/api/probe" });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.json, { error: { type: "bad-request", message: "q is required" } });
    assert.equal(reached, false);
    // Positive control: with the parameter the same route answers.
    const good = await call(probing, { path: "/api/probe?q=1" });
    assert.equal(good.status, 200);
    assert.equal(good.json.kind, "stats");
  } finally {
    await probing.close();
  }
  assert.throws(() => new RequestError("x", { status: 500 }), RangeError);
});

/* ---------- UI-2's cache, joined to the server (UI-3) ---------- */

function countingShim() {
  const shimDir = mkdtempSync(join(tmpdir(), "branchling-ui-server-shim-"));
  const counter = join(shimDir, "spawns");
  writeFileSync(counter, "");
  let bin;
  if (process.platform === "win32") {
    bin = join(shimDir, "counting-branchling.cmd");
    writeFileSync(bin, `@echo spawn>>"${counter}"\r\n@call "${BIN}" %*\r\n`);
  } else {
    bin = join(shimDir, "counting-branchling");
    writeFileSync(bin, `#!/bin/sh\necho spawn >> '${counter}'\nexec '${BIN}' "$@"\n`);
    chmodSync(bin, 0o755);
  }
  return { bin, spawns: () => readFileSync(counter, "utf8").split("\n").filter(Boolean).length, cleanup: () => rmSync(shimDir, { recursive: true, force: true }) };
}

test("through the cache, a second identical GET spawns nothing and keeps its fetched-at", async () => {
  const shim = countingShim();
  const racyMs = 300;
  const cache = createCache(createAdapter({ bin: shim.bin, dir, cwd: root }), { changes: createFileChanges({ dir, cwd: root, racyMs }) });
  const cached = await createServer({ adapter: servedFromCache(cache), port: 0 });
  try {
    await sleep(racyMs + 150); // the fixture was just written; let it settle
    const first = await call(cached, { path: "/api/stats" });
    assert.equal(first.status, 200);
    assert.equal(first.json.kind, "stats");
    assert.equal(first.json.stats.total, 1);
    const at = first.headers["x-branchling-ui-fetched-at"];
    assert.match(at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    // A hit is not stale: nothing changed since the answer was computed.
    assert.equal(first.headers["x-branchling-ui-stale"], undefined);
    const afterFirst = shim.spawns();
    assert.equal(afterFirst, 1, "positive control: the first read spawned");

    const second = await call(cached, { path: "/api/stats" });
    assert.equal(second.status, 200);
    assert.deepEqual(second.json, first.json);
    assert.equal(second.headers["x-branchling-ui-fetched-at"], at);
    assert.equal(second.headers["x-branchling-ui-stale"], undefined);
    assert.equal(shim.spawns(), afterFirst, "the second read spawned nothing");

    // The plan view's route goes through the same cache.
    const plan = await call(cached, { path: "/api/plan" });
    assert.equal(plan.status, 200);
    assert.equal(plan.json.kind, "plan");
    assert.equal(shim.spawns(), afterFirst + 1);
  } finally {
    await cached.close();
    shim.cleanup();
  }
});

test("each request's scope reports only its own reads, so concurrent requests cannot mix times", async () => {
  let clock = 1000;
  const fake = {
    stats: async () => ({ schemaVersion: 1, kind: "stats" }),
    plan: async () => ({ schemaVersion: 1, kind: "plan" }),
  };
  const served = servedFromCache(createCache(fake, { changes: { token: async () => "same" }, now: () => clock++ }));
  const a = served.forRequest();
  const b = served.forRequest();
  const c = served.forRequest();
  const [envA] = await Promise.all([a.adapter.stats(), b.adapter.plan()]);
  assert.equal(envA.kind, "stats", "a scope hands out the bare envelope");
  assert.equal(a.answeredAt(), 1000);
  assert.equal(b.answeredAt(), 1001);
  assert.equal(c.answeredAt(), null, "a scope that read nothing knows no time");
  // A later hit in a new scope carries the time of the spawn, not of the hit.
  const d = served.forRequest();
  await d.adapter.stats();
  assert.equal(d.answeredAt(), 1000);
  // Several reads in one request: the oldest answer is what the response is as of.
  const e = served.forRequest();
  await e.adapter.plan();
  await e.adapter.stats();
  assert.equal(e.answeredAt(), 1000);
});

test("the started interface finds the backlog from its working directory and serves it cached", async () => {
  const binPath = fileURLToPath(new URL("../bin/branchling-ui.mjs", import.meta.url));
  const child = spawn(process.execPath, [binPath, "--port", "0", "--bin", BIN], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", d => { stderr += d; });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = "";
      child.stdout.on("data", d => {
        out += d;
        const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
        if (m) resolve(Number(m[1]));
      });
      child.on("exit", code => reject(new Error(`exited ${code}: ${stderr}`)));
    });
    const srv = { port };
    await sleep(2200); // RACY_MS: the bin uses the cache's defaults
    const first = await call(srv, { path: "/api/stats" });
    assert.equal(first.status, 200);
    assert.equal(realpathSync(first.json.root), realpathSync(dir));
    const second = await call(srv, { path: "/api/stats" });
    assert.ok(first.headers["x-branchling-ui-fetched-at"], "the cache reports when it answered");
    assert.equal(second.headers["x-branchling-ui-fetched-at"], first.headers["x-branchling-ui-fetched-at"]);
    assert.doesNotMatch(stderr, /serving uncached/);
  } finally {
    child.kill();
  }
});
