/**
 * Release planning (UI-8): `adapter.declare()`, one `branchling declare
 * releases`, POST /api/release/declare behind the write guard, and planning a
 * task through UI-6's `set` path, against the REAL branchling executable over
 * test/fixtures/release-manage-backlog.mjs (release 1.0 declared, 1.1 not;
 * TASK-2 and TASK-3 open and planned for no release; TASK-4 planned for 1.0).
 * Requests go through node:http, because fetch cannot set the Host header the
 * guard judges.
 *
 * "Selectable" is measured from branchling's own data, never config.yaml:
 * no read of 0.3.0 lists the declared releases, so a release is selectable
 * when `deploy status --release <name>` and `query --release <name>` answer
 * with an envelope. Before it is declared, both are usage errors.
 *
 * A test that writes builds its own fixture, so the order does not matter.
 */

import "./fixtures/private-homes.mjs";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAdapter, run, BranchlingRefusal, BranchlingUsageError } from "../src/adapter.mjs";
import { createServer, CAPABILITY_HEADER } from "../src/server.mjs";
import { createCache, createFileChanges, servedFromCache } from "../src/cache.mjs";
import { FIELD_EDIT_PATH } from "../src/view-model/task-fields.mjs";
import { releaseModel } from "../src/view-model/release.mjs";
import {
  DECLARE_PATH, declareCommand, declareFailure, declareRecorded,
  planChanges, planCommand, planningModel, seenReleases, validateDeclare,
} from "../src/view-model/release-planning.mjs";
import { BIN, buildReleaseManageBacklog, fixtureEnv } from "./fixtures/release-manage-backlog.mjs";

const ACTOR = "local:maja";
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "branchling-ui-release-manage-"));
  roots.push(root);
  const repo = join(root, "repo");
  const fx = await buildReleaseManageBacklog(repo, { bin: BIN });
  const env = { ...fixtureEnv(repo), BACKLOG_ACTOR: ACTOR };
  return { ...fx, env, adapter: createAdapter({ bin: BIN, dir: fx.dir, cwd: fx.root, env }) };
}

/** The fixture's own config.yaml, read by the TEST (never by product code). */
const config = fx => readFileSync(join(fx.dir, "config.yaml"), "utf8");

const failure = promise => promise.then(() => null, err => err);
const ids = list => list.tasks.map(t => t.id).sort();

function call(srv, { method = "GET", path = "/", headers = {}, body } = {}) {
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
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const servers = [];
after(() => Promise.all(servers.map(s => s.close())));

async function serve(fx) {
  const cached = servedFromCache(createCache(fx.adapter, { dir: fx.dir, cwd: fx.root }));
  const server = await createServer({ adapter: cached, port: 0, log: () => {} });
  servers.push(server);
  const page = await call(server);
  const token = page.text.match(/name="branchling-ui-capability" content="([^"]+)"/)[1];
  const host = `127.0.0.1:${server.port}`;
  const post = (path, value, headers = {}) => call(server, {
    method: "POST",
    path,
    headers: { host, origin: `http://${host}`, [CAPABILITY_HEADER]: token, "content-type": "application/json", ...headers },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
  const get = path => call(server, { path });
  return { server, token, host, post, get };
}

// --- the acceptance criterion ----------------------------------------------------------

test("declaring a release makes it selectable, and planning a task for it is visible in query --release", async () => {
  const fx = await fixture();

  // Before: 1.1 is not a release branchling knows; 1.0 is (positive control).
  for (const read of [() => fx.adapter.deployStatus({ release: "1.1" }), () => fx.adapter.query({ release: "1.1" })]) {
    const err = await failure(read());
    assert.ok(err instanceof BranchlingUsageError, `expected a usage error before declaring, got ${err}`);
    assert.match(err.stderr, /1\.1/);
  }
  assert.equal((await fx.adapter.deployStatus({ release: "1.0" })).release.name, "1.0");
  assert.deepEqual(ids(await fx.adapter.query({ release: "1.0" })), ["TASK-4"]);

  const declared = await fx.adapter.declare("releases", "1.1", { reason: "The second release." });
  assert.equal(declared.kind, "vocabulary-declare");
  assert.equal(declared.ok, true);
  assert.equal(declared.key, "releases");
  assert.equal(declared.name, "1.1");
  assert.deepEqual(declared.entry, { name: "1.1", ref: null });
  assert.equal(declared.reason, "The second release.");

  // Selectable: branchling's own reads accept it now, with nothing planned yet.
  const status = await fx.adapter.deployStatus({ release: "1.1" });
  assert.equal(status.kind, "release-status");
  assert.equal(status.release.name, "1.1");
  assert.equal(status.release.planned, 0);
  assert.equal(releaseModel(status).release.name, "1.1");
  assert.deepEqual(ids(await fx.adapter.query({ release: "1.1" })), []);

  // Plan TASK-2 for it through the field-write command.
  const set = await fx.adapter.set("TASK-2", "release", "1.1", { reason: "It belongs in the second release." });
  assert.equal(set.kind, "task-set");
  assert.equal(set.value, "1.1");
  assert.deepEqual(set.changes.map(c => [c.field, c.from, c.to, c.actor]), [["release", "", "1.1", ACTOR]]);

  // Visible in query --release 1.1; TASK-3 (another open task) is not, and
  // 1.0 keeps only TASK-4.
  const planned = await fx.adapter.query({ release: "1.1" });
  assert.deepEqual(ids(planned), ["TASK-2"]);
  assert.equal(planned.tasks[0].release, "1.1");
  assert.ok(!ids(planned).includes("TASK-3"));
  assert.deepEqual(ids(await fx.adapter.query({ release: "1.0" })), ["TASK-4"]);
  // And in the comparison the release view renders.
  const compared = await fx.adapter.deployStatus({ release: "1.1" });
  assert.equal(compared.release.planned, 1);
  assert.deepEqual(compared.release.open.tasks.map(t => t.id), ["TASK-2"]);

  // An undeclared release is refused by set, and nothing is planned for it.
  const undeclared = await failure(fx.adapter.set("TASK-3", "release", "9.9"));
  assert.ok(undeclared instanceof BranchlingRefusal, `expected a refusal, got ${undeclared}`);
  assert.equal(undeclared.envelope.kind, "task-set");
  assert.equal(undeclared.envelope.refusalKind, "usage");
  assert.match(undeclared.envelope.refusal, /9\.9/);
  assert.equal((await fx.adapter.query({ release: "" })).tasks.find(t => t.id === "TASK-3").release, "");
});

// --- the adapter call ------------------------------------------------------------------

test("declare writes one entry with its reason as a comment, and a duplicate is a refusal (exit 1)", async () => {
  const fx = await fixture();
  const ok = await fx.adapter.declare("releases", "2.0", { reason: "Shipped already.", ref: "v2.0" });
  assert.deepEqual(ok.entry, { name: "2.0", ref: "v2.0" });
  assert.ok(typeof ok.file === "string" && ok.file.endsWith("config.yaml"));
  // The test reads the fixture's own file: the comment and the entry are there.
  assert.match(config(fx), /# Shipped already\.\n\s*- \{ name: 2\.0, ref: v2\.0 \}/);

  const dup = await failure(fx.adapter.declare("releases", "2.0", { reason: "Again." }));
  assert.ok(dup instanceof BranchlingRefusal, `expected a refusal, got ${dup}`);
  assert.equal(dup.code, 1);
  assert.equal(dup.envelope.kind, "vocabulary-declare");
  assert.equal(dup.envelope.refusalKind, "duplicate");
  assert.equal(dup.envelope.entry, null);
  assert.match(dup.envelope.details.join(" "), /hand edit/);
  assert.equal(config(fx).match(/name: 2\.0/g).length, 1);

  // The fixture's own 1.0 is a duplicate too; a fresh name is not (positive control).
  const first = await failure(fx.adapter.declare("releases", "1.0", { reason: "Again." }));
  assert.equal(first.envelope.refusalKind, "duplicate");
  assert.equal((await fx.adapter.declare("releases", "2.1", { reason: "Next." })).name, "2.1");
});

test("a malformed name is branchling's refusal (exit 2), and a missing reason is refused before and by branchling", async () => {
  const fx = await fixture();
  const malformed = await failure(fx.adapter.declare("releases", "Two Words", { reason: "Bad." }));
  assert.ok(malformed instanceof BranchlingRefusal);
  assert.equal(malformed.code, 2);
  assert.equal(malformed.envelope.refusalKind, "malformed");

  // Refused here, before a spawn: no reason, an empty one, values that are flags, another key.
  for (const [key, name, opts] of [
    ["releases", "3.0", {}],
    ["releases", "3.0", { reason: "  " }],
    ["releases", "-x", { reason: "r" }],
    ["releases", "3.0", { reason: "--actor" }],
    ["releases", "3.0", { reason: "r", ref: "-bad" }],
    ["deploy_targets", "web", { reason: "r" }],
  ]) {
    const err = await failure(fx.adapter.declare(key, name, opts));
    assert.ok(err instanceof BranchlingUsageError, `${key} ${name} ${JSON.stringify(opts)}: ${err}`);
  }
  assert.doesNotMatch(config(fx), /3\.0/);

  // branchling is the authority on the reason too: run without it, it refuses.
  const { code, stdout } = await run(BIN, ["declare", "releases", "3.0", "--json", "--dir", fx.dir], { cwd: fx.root, env: fx.env });
  assert.equal(code, 2);
  const envelope = JSON.parse(stdout);
  assert.equal(envelope.kind, "vocabulary-declare");
  assert.equal(envelope.refusalKind, "usage");
  assert.match(envelope.refusal, /--reason/);
  assert.doesNotMatch(config(fx), /3\.0/);
});

test("through the cache, declare is a write: the next release read spawns and sees it; a config.yaml change made elsewhere is seen too", async () => {
  const fx = await fixture();
  // racyMs 0: the fixture was just written, and this test is about what a
  // write does, not about the racy-timestamp window (test/cache.test.mjs).
  const cache = createCache(fx.adapter, { changes: createFileChanges({ dir: fx.dir, cwd: fx.root, racyMs: 0 }) });
  const before = await failure(cache.deployStatus({ release: "1.1" }));
  assert.ok(before instanceof BranchlingUsageError);
  const warm = await cache.deployStatus({ release: "1.0" });
  assert.equal((await cache.deployStatus({ release: "1.0" })).fromCache, true, "an unchanged backlog is answered from memory");
  assert.equal(warm.fromCache, false);

  await cache.declare("releases", "1.1", { reason: "Through the cache." });
  const after1 = await cache.deployStatus({ release: "1.1" });
  assert.equal(after1.fromCache, false);
  assert.equal(after1.envelope.release.name, "1.1");
  assert.equal((await cache.deployStatus({ release: "1.0" })).fromCache, false, "the write dropped what was held");

  // Another process declares 1.2 (not through this cache): the fingerprint sees config.yaml change.
  const { code } = await run(BIN, ["declare", "releases", "1.2", "--reason", "Elsewhere.", "--json", "--dir", fx.dir], { cwd: fx.root, env: fx.env });
  assert.equal(code, 0);
  const elsewhere = await cache.deployStatus({ release: "1.2" });
  assert.equal(elsewhere.envelope.release.name, "1.2");
});

// --- the routes ------------------------------------------------------------------------

test("POST /api/release/declare declares through branchling, and the release read after it accepts the name", async () => {
  const fx = await fixture();
  const srv = await serve(fx);

  const before = await srv.get("/api/release?release=1.1");
  assert.equal(before.status, 422, before.text);
  assert.equal(before.json.error.type, "rejected-input");
  assert.equal(before.json.error.declared.release, null, "no read lists the declared releases");

  const res = await srv.post(DECLARE_PATH, { name: " 1.1 ", reason: " The second release. " });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.kind, "vocabulary-declare");
  assert.equal(res.json.name, "1.1");
  assert.equal(res.json.reason, "The second release.");

  const afterRead = await srv.get("/api/release?release=1.1");
  assert.equal(afterRead.status, 200, afterRead.text);
  assert.equal(afterRead.json.release.name, "1.1");

  // Planning goes through UI-6's route, the one write path for `set`.
  const planned = await srv.post(FIELD_EDIT_PATH, { id: "TASK-3", field: "release", value: "1.1" });
  assert.equal(planned.status, 200, planned.text);
  assert.equal(planned.json.value, "1.1");
  const list = await srv.get("/api/tasks");
  assert.equal(list.json.tasks.find(t => t.id === "TASK-3").release, "1.1");
  assert.equal(list.json.tasks.find(t => t.id === "TASK-2").release, "");
  const compared = await srv.get("/api/release?release=1.1");
  assert.deepEqual(compared.json.release.open.tasks.map(t => t.id), ["TASK-3"]);
});

test("POST /api/release/declare: a duplicate is a 409 refusal with branchling's text; a fresh name is a 200 (positive control)", async () => {
  const fx = await fixture();
  const srv = await serve(fx);
  const dup = await srv.post(DECLARE_PATH, { name: "1.0", reason: "Again." });
  assert.equal(dup.status, 409, dup.text);
  assert.equal(dup.json.error.type, "refusal");
  assert.equal(dup.json.error.refusalKind, "duplicate");
  assert.equal(dup.json.error.envelope.kind, "vocabulary-declare");
  const model = declareFailure(dup.json, dup.status);
  assert.equal(model.state, "refusal");
  assert.equal(model.detail, dup.json.error.envelope.refusal);
  assert.match(model.details.join(" "), /hand edit/);
  assert.equal(model.refusalKind, "duplicate");

  const malformed = await srv.post(DECLARE_PATH, { name: "Two Words", reason: "Bad." });
  assert.equal(malformed.status, 409);
  assert.equal(malformed.json.error.refusalKind, "malformed");

  const fresh = await srv.post(DECLARE_PATH, { name: "1.1", reason: "Fresh.", ref: "v1.1" });
  assert.equal(fresh.status, 200, fresh.text);
  assert.deepEqual(fresh.json.entry, { name: "1.1", ref: "v1.1" });
});

test("POST /api/release/declare refuses an actor, an unknown key or a missing reason with a 400 and nothing written", async () => {
  const fx = await fixture();
  const srv = await serve(fx);
  const before = config(fx);
  for (const body of [
    { name: "1.1", reason: "r", actor: "human:mallory" },
    { name: "1.1", reason: "r", key: "deploy_targets" },
    { name: "1.1", reason: "r", "take-over": true },
    { name: "1.1" },
    { name: "1.1", reason: "   " },
    { name: "", reason: "r" },
    { name: "-x", reason: "r" },
    { name: "1.1", reason: "r", ref: "--json" },
    [],
  ]) {
    const res = await srv.post(DECLARE_PATH, body);
    assert.equal(res.status, 400, `${JSON.stringify(body)}: ${res.text}`);
    assert.equal(res.json.error.type, "bad-request");
  }
  assert.equal(config(fx), before, "config.yaml is unchanged");
  // Positive control: the same request without the actor goes through.
  assert.equal((await srv.post(DECLARE_PATH, { name: "1.1", reason: "r" })).status, 200);
});

test("POST /api/release/declare is behind the write guard: no token, a foreign origin or a foreign host is a 403", async () => {
  const fx = await fixture();
  const srv = await serve(fx);
  const before = config(fx);
  const body = { name: "1.1", reason: "r" };
  for (const headers of [
    { [CAPABILITY_HEADER]: "" },
    { [CAPABILITY_HEADER]: "0".repeat(64) },
    { origin: "http://evil.example" },
    { host: `evil.example:${srv.server.port}` },
  ]) {
    const res = await srv.post(DECLARE_PATH, body, headers);
    assert.equal(res.status, 403, `${JSON.stringify(headers)}: ${res.text}`);
  }
  assert.equal(config(fx), before);
  const get = await srv.get(DECLARE_PATH);
  assert.equal(get.status, 404, "there is no GET route at the write's path");
  assert.equal((await srv.post(DECLARE_PATH, body)).status, 200, "positive control");
});

// --- the view model --------------------------------------------------------------------

test("validateDeclare takes { name, reason, ref? }, trimmed, requires the reason and never takes an actor", () => {
  assert.deepEqual(validateDeclare({ name: " 1.1 ", reason: " why " }), { ok: true, value: { name: "1.1", reason: "why" } });
  assert.deepEqual(validateDeclare({ name: "1.1", reason: "why", ref: " v1.1 " }).value, { name: "1.1", reason: "why", ref: "v1.1" });
  assert.deepEqual(validateDeclare({ name: "1.1", reason: "why", ref: "" }).value, { name: "1.1", reason: "why" });
  assert.equal(validateDeclare({ name: "1.1" }).field, "reason");
  assert.equal(validateDeclare({ name: "  ", reason: "r" }).field, "name");
  assert.equal(validateDeclare({ name: "-x", reason: "r" }).field, "name");
  assert.equal(validateDeclare({ name: "1.1", reason: "r", ref: "-x" }).field, "ref");
  assert.equal(validateDeclare({ name: "1.1", reason: "a\u0007" }).field, "reason");
  assert.match(validateDeclare({ name: "1.1", reason: "r", actor: "x" }).message, /actor/);
  assert.equal(validateDeclare(null).ok, false);
});

test("the command preview names declare and set, never an --actor", () => {
  assert.equal(declareCommand("1.1", "The second", "").text, 'branchling declare releases 1.1 --reason "The second"');
  assert.equal(declareCommand("1.1", "r", "v1.1").text, 'branchling declare releases 1.1 --reason "r" --ref v1.1');
  assert.equal(declareCommand("", "", "").text, 'branchling declare releases <name> --reason "…"');
  assert.equal(planCommand("TASK-2", "1.1"), "branchling set TASK-2 release 1.1");
  assert.equal(planCommand("TASK-2", ""), 'branchling set TASK-2 release ""');
  for (const text of [declareCommand("a", "b", "c").text, planCommand("T-1", "a")]) assert.doesNotMatch(text, /--actor/);
});

test("planningModel marks the tasks planned for the release; planChanges asks only for the boxes that changed", async () => {
  const fx = await fixture();
  const list = await fx.adapter.query();
  const model = planningModel(list, "1.0");
  assert.deepEqual(model.tasks.map(t => [t.id, t.planned, t.elsewhere]).sort(), [["TASK-2", false, null], ["TASK-3", false, null], ["TASK-4", true, null]]);
  const other = planningModel(list, "1.1");
  assert.equal(other.tasks.find(t => t.id === "TASK-4").elsewhere, "1.0");
  assert.deepEqual(planChanges(model, ["TASK-2", "TASK-4"], "1.0"), [{ id: "TASK-2", field: "release", value: "1.0" }]);
  assert.deepEqual(planChanges(model, [], "1.0"), [{ id: "TASK-4", field: "release", value: "" }]);
  assert.deepEqual(planChanges(model, ["TASK-4"], "1.0"), []);
  assert.equal(planningModel({ kind: "task-list", tasks: [] }, "1.0").state, "empty");

  const status = await fx.adapter.deployStatus({ release: "1.0" });
  assert.deepEqual(seenReleases({ list, status, declared: ["1.1"] }), ["1.0", "1.1"]);
  assert.deepEqual(seenReleases({}), []);
});

test("declareRecorded says what branchling wrote and where", () => {
  const rec = declareRecorded({ kind: "vocabulary-declare", ok: true, key: "releases", name: "1.1", entry: { name: "1.1", ref: "v1.1" }, reason: "r", file: "/x/config.yaml" });
  assert.equal(rec.name, "1.1");
  assert.equal(rec.ref, "v1.1");
  assert.match(rec.message, /1\.1 is declared in \/x\/config\.yaml/);
  assert.match(rec.refText, /v1\.1/);
});
