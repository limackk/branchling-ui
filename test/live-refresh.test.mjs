/**
 * Live refresh (UI-7) against the REAL branchling executable over a fixture
 * backlog built in a temporary directory: the adapter's `follow` handle, the
 * live source, the cache's combination with the fingerprint, and the
 * server's GET /api/events, read through node:http so the test can set the
 * Host header the guard judges.
 *
 * Every change is made by a branchling command (`set`), never by writing a
 * task file from here.
 */

import "./fixtures/private-homes.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter, once } from "node:events";

import { createAdapter, run, ContractMismatch, parseChangeLine } from "../src/adapter.mjs";
import { createCache, createFileChanges, servedFromCache, withLiveChanges } from "../src/cache.mjs";
import { createLive } from "../src/live.mjs";
import { createServer, EVENTS_PATH } from "../src/server.mjs";
import { LIVE_TEXT, liveNotice } from "../src/view-model/live.mjs";
import { fixtureEnv } from "./fixtures/env.mjs";
import { BIN, buildTaskBacklog } from "./fixtures/task-backlog.mjs";

/** Generous, but bounded: a `follow` arms in well under a second. */
const WAIT_MS = 15_000;

let root;
let dir;
let branchling;
let adapter;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "branchling-ui-live-"));
  ({ dir } = await buildTaskBacklog(root));
  const env = fixtureEnv(root);
  adapter = createAdapter({ bin: BIN, dir, cwd: root, env });
  branchling = async args => {
    const { code, stderr } = await run(BIN, [...args, "--dir", dir], { cwd: root, env });
    assert.equal(code, 0, `branchling ${args.join(" ")} exited ${code}: ${stderr}`);
  };
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Resolves with the first value `pick(item)` returns truthy for, from `emitter`'s `name` events. */
function waitFor(emitter, name, pick = () => true, ms = WAIT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { emitter.off(name, on); reject(new Error(`no matching "${name}" within ${ms} ms`)); }, ms);
    function on(item) {
      if (!pick(item)) return;
      clearTimeout(timer);
      emitter.off(name, on);
      resolve(item);
    }
    emitter.on(name, on);
  });
}

/**
 * True while the follow child or anything it started runs. `branchling` is a
 * launcher whose watcher is its child, so on POSIX the adapter makes the
 * launcher a process-group leader and this asks about the whole group.
 */
function alive(pid) {
  const target = process.platform === "win32" ? pid : -pid;
  try { process.kill(target, 0); return true; } catch (err) { return err.code === "EPERM"; }
}

async function gone(pid, ms = WAIT_MS) {
  const end = Date.now() + ms;
  while (alive(pid)) {
    if (Date.now() > end) return false;
    await new Promise(r => setTimeout(r, 50));
  }
  return true;
}

/**
 * The event stream of `srv`, parsed. `events` is every event so far, and
 * `next(type, pick)` waits for the next one of that type.
 */
function openEvents(srv, { host = `127.0.0.1:${srv.port}` } = {}) {
  const events = [];
  let cursor = 0;
  const emitter = new EventEmitter();
  let res = null;
  const ready = new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: srv.port, path: EVENTS_PATH, headers: { host, accept: "text/event-stream" } }, response => {
      res = response;
      response.setEncoding("utf8");
      let buffer = "";
      response.on("data", chunk => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let type = "message";
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) type = line.slice(7);
            else if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (!data) continue; // retry: and keep-alive comments
          const event = { type, ...JSON.parse(data) };
          events.push(event);
          emitter.emit("event", event);
        }
      });
      resolve(response);
    });
    req.on("error", reject);
    req.end();
  });
  return {
    events,
    ready,
    // The next matching event after the one the previous next() returned,
    // whether it has already arrived or not: no wait can miss an event.
    next(type, pick = () => true, ms) {
      const match = e => e.type === type && pick(e);
      const i = events.findIndex((e, n) => n >= cursor && match(e));
      if (i !== -1) { cursor = i + 1; return Promise.resolve(events[i]); }
      return waitFor(emitter, "event", match, ms).then(e => { cursor = events.indexOf(e) + 1; return e; });
    },
    close: () => res?.destroy(),
  };
}

/* ---------- the adapter's follow handle (contract) ---------- */

test("follow --json is armed with a ready envelope and reports a change made by set, naming the task", async () => {
  const handle = adapter.follow({ heartbeat: 0 });
  try {
    const envelopes = [];
    handle.on("envelope", e => envelopes.push(e));
    const ready = await waitFor(handle, "envelope", e => e.event === "ready");
    assert.equal(ready.kind, "change-stream");
    assert.equal(ready.schemaVersion, 1);
    assert.equal(ready.id, null);
    // Listening BEFORE the write: under load the event can arrive while `set` is still exiting.
    const changed = waitFor(handle, "envelope", e => e.event === "change");
    await branchling(["set", "TASK-3", "priority", "P3", "--reason", "live refresh contract test", "--actor", "agent:test"]);
    const change = await changed;
    assert.equal(change.id, "TASK-3");
    assert.equal(change.change, "modified");
    assert.deepEqual(change.fields, ["priority"]);
    assert.match(change.file, /^TASK-3-/);
    // Positive control for "only the changed task": nothing else was named.
    assert.deepEqual(envelopes.filter(e => e.event === "change").map(e => e.id), ["TASK-3"]);
  } finally {
    const exit = await handle.close();
    assert.ok(exit.signal === "SIGTERM" || exit.code === 0, `follow stopped with ${JSON.stringify(exit)}`);
  }
  assert.equal(await gone(handle.pid), true, "the watcher went with the launcher");
});

test("follow --max-events 0 arms, confirms and exits 0", async () => {
  const handle = adapter.follow({ maxEvents: 0, heartbeat: 0 });
  const seen = [];
  handle.on("envelope", e => seen.push(e.event));
  const [exit] = await once(handle, "exit");
  assert.equal(exit.code, 0, exit.stderr);
  assert.deepEqual(seen, ["ready"]);
});

test("a line that is not a change-stream envelope is a ContractMismatch event, and the stream goes on", async () => {
  if (process.platform === "win32") return; // a shell-script shim; the parsing is the same everywhere
  const fake = join(root, "fake-follow");
  const ok = line => JSON.stringify({ schemaVersion: 1, kind: "change-stream", event: line.event, at: "2026-11-03T00:00:00.000Z", root: dir, id: line.id ?? null, file: null, change: line.change ?? null, fields: line.fields ?? [] });
  writeFileSync(fake, [
    "#!/bin/sh",
    `printf '%s\\n' '${ok({ event: "ready" })}'`,
    "printf '%s\\n' 'this is not json'",
    `printf '%s\\n' '${JSON.stringify({ schemaVersion: 99, kind: "change-stream", event: "ready", fields: [] })}'`,
    `printf '%s\\n' '${ok({ event: "change", id: "TASK-1", change: "renamed", fields: [] })}'`,
    `printf '%s\\n' '${ok({ event: "change", id: "TASK-2", change: "modified", fields: ["title"] })}'`,
    "",
  ].join("\n"));
  chmodSync(fake, 0o755);
  const handle = createAdapter({ bin: fake, dir }).follow();
  const envelopes = [];
  const mismatches = [];
  handle.on("envelope", e => envelopes.push(e));
  handle.on("mismatch", e => mismatches.push(e));
  const [exit] = await once(handle, "exit");
  assert.equal(exit.code, 0);
  assert.equal(mismatches.length, 3);
  for (const m of mismatches) assert.ok(m instanceof ContractMismatch);
  assert.match(mismatches[1].message, /schemaVersion 99/);
  assert.match(mismatches[2].message, /renamed/);
  // Positive control: the valid lines around the bad ones came through.
  assert.deepEqual(envelopes.map(e => [e.event, e.id]), [["ready", null], ["change", "TASK-2"]]);
});

test("parseChangeLine refuses another kind and a change without a task id", () => {
  assert.throws(() => parseChangeLine(JSON.stringify({ schemaVersion: 1, kind: "task-list", event: "ready", fields: [] })), ContractMismatch);
  assert.throws(() => parseChangeLine(JSON.stringify({ schemaVersion: 1, kind: "change-stream", event: "change", id: null, change: "modified", fields: [] })), ContractMismatch);
  assert.equal(parseChangeLine(JSON.stringify({ schemaVersion: 1, kind: "change-stream", event: "heartbeat", id: null, fields: [] })).event, "heartbeat");
});

test("follow refuses a heartbeat that is not a whole number before anything runs", () => {
  assert.throws(() => adapter.follow({ heartbeat: "--max-events" }), /whole number/);
  assert.throws(() => adapter.follow({ maxEvents: -1 }), /whole number/);
});

/* ---------- the cache: the stream adds misses, the fingerprint still decides ---------- */

test("with a fingerprint that never moves, a change event alone makes the next read miss", async () => {
  const live = createLive({ adapter, heartbeat: 0, log: () => {} });
  const frozen = { token: async () => "constant" };
  const cache = createCache(adapter, { changes: withLiveChanges(frozen, live) });
  try {
    const armed = new Promise(resolve => live.subscribe(e => { if (e.type === "connected") resolve(); }));
    await armed;
    const first = await cache.show("TASK-2");
    const hit = await cache.show("TASK-2");
    assert.equal(hit.fromCache, true, "positive control: an unchanged backlog is answered from memory");
    const changed = new Promise(resolve => live.subscribe(e => { if (e.type === "change") resolve(e); }));
    await branchling(["set", "TASK-2", "priority", "P1", "--reason", "live refresh cache test", "--actor", "agent:test"]);
    assert.equal((await changed).id, "TASK-2");
    const after = await cache.show("TASK-2");
    assert.equal(after.fromCache, false);
    assert.equal(after.envelope.priority, "P1");
    assert.notEqual(first.envelope.priority, "P1");
  } finally {
    await live.close();
  }
});

test("while the stream is not live the combined source vouches for exactly what the fingerprint does", async () => {
  const snapshots = [{ state: "starting", generation: 0 }];
  const fake = { snapshot: () => snapshots[0] };
  assert.equal(await withLiveChanges({ token: async () => null }, fake).token(), null);
  assert.equal(await withLiveChanges({ token: async () => "fp" }, fake).token(), "0:fp");
  // An event during the fingerprint: no vouching for either side of it.
  const racing = { token: async () => { snapshots[0] = { state: "live", generation: 1 }; return "fp"; } };
  assert.equal(await withLiveChanges(racing, fake).token(), null);
});

/* ---------- the server's event stream ---------- */

test("the event stream: one change naming the task, a fresh read after it, restart after a kill, no orphan on close", async () => {
  const logs = [];
  const live = createLive({ adapter, heartbeat: 5, backoff: { initialMs: 200, maxMs: 1000 }, log: line => logs.push(line) });
  live.start();
  const cache = createCache(adapter, { changes: withLiveChanges(createFileChanges({ dir, cwd: root }), live) });
  const server = await createServer({ adapter: servedFromCache(cache), live, port: 0, keepAliveMs: 1000, log: () => {} });
  let stream;
  try {
    // A foreign Host is refused here as on every route.
    const foreign = openEvents(server, { host: `evil.example:${server.port}` });
    const refused = await foreign.ready;
    assert.equal(refused.statusCode, 403);
    foreign.close();

    stream = openEvents(server);
    const res = await stream.ready;
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"], /^text\/event-stream/);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.headers["access-control-allow-origin"], undefined, "no CORS: a foreign page cannot read the stream");
    assert.match(res.headers["content-security-policy"], /default-src 'self'/);
    await stream.next("connected");

    // A read before the change, through the server's own cache.
    const before = await getJson(server, "/api/task/panel?id=TASK-1");
    assert.equal(before.show.priority, "P1");

    const count = stream.events.length;
    const changed = stream.next("change"); // before the write, as above
    await branchling(["set", "TASK-1", "priority", "P2", "--reason", "live refresh server test", "--actor", "agent:test"]);
    const change = await changed;
    assert.equal(change.id, "TASK-1");
    assert.equal(change.change, "modified");
    assert.deepEqual(change.fields, ["priority"]);
    // branchling folds the writes of one `set` into one comparison, so one
    // command is one event. Wait a moment for a second one that must not come.
    await new Promise(r => setTimeout(r, 1000));
    const changes = stream.events.slice(count).filter(e => e.type === "change");
    assert.deepEqual(changes.map(e => e.id), ["TASK-1"], "exactly one change event for one set");

    const fresh = await getJson(server, "/api/task/panel?id=TASK-1");
    assert.equal(fresh.show.priority, "P2", "the cached read after the change is not stale");

    // Killed from outside: disconnected, then connected again with a resync.
    const firstPid = live.pid;
    assert.ok(alive(firstPid));
    const down = stream.next("disconnected");
    process.kill(firstPid, "SIGKILL"); // the launcher only: its watcher must not outlive it
    await down;
    const back = await stream.next("connected");
    assert.equal(back.resync, true, "a change may have been missed while down");
    assert.notEqual(live.pid, firstPid);
    assert.equal(await gone(firstPid), true);
    assert.ok(logs.some(l => /follow stopped/.test(l)));

    // The restarted stream still delivers.
    const again = stream.next("change");
    await branchling(["set", "TASK-1", "priority", "P1", "--reason", "live refresh server test", "--actor", "agent:test"]);
    assert.equal((await again).id, "TASK-1");
  } finally {
    stream?.close();
    const pid = live.pid;
    await server.close();
    if (pid) assert.equal(await gone(pid), true, "closing the server leaves no follow process");
    assert.equal(live.pid, null);
  }
});

test("a server given no live source answers /api/events with 404", async () => {
  const server = await createServer({ adapter, port: 0, log: () => {} });
  try {
    const res = await getJson(server, EVENTS_PATH, { raw: true });
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("a later subscriber to a live stream is told it is connected, with no resync", async () => {
  const live = createLive({ adapter, heartbeat: 0, log: () => {} });
  try {
    await new Promise(resolve => live.subscribe(e => { if (e.type === "connected") resolve(); }));
    const told = [];
    live.subscribe(e => told.push(e));
    assert.deepEqual(told, [{ type: "connected", resync: false }]);
  } finally {
    await live.close();
  }
});

test("the notice: nothing while live, the disconnected text while down, which wins over a deferred refresh", () => {
  assert.equal(liveNotice({ connection: "live", deferred: false }), null);
  assert.equal(liveNotice({ connection: "unknown", deferred: false }), null);
  assert.equal(liveNotice({ connection: "down", deferred: true }).text, LIVE_TEXT.disconnected);
  assert.equal(liveNotice({ connection: "live", deferred: true }).text, LIVE_TEXT.deferred);
});

function getJson(srv, path, { raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: srv.port, path, headers: { host: `127.0.0.1:${srv.port}` } }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", c => { text += c; });
      res.on("end", () => {
        if (raw) { resolve({ status: res.statusCode, text }); return; }
        if (res.statusCode !== 200) { reject(new Error(`${path}: ${res.statusCode} ${text}`)); return; }
        resolve(JSON.parse(text));
      });
    });
    req.on("error", reject);
    req.end();
  });
}
