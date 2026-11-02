/**
 * The health view (UI-28) against the REAL branchling executable over a
 * healthy and a broken fixture backlog (test/fixtures/health-backlog.mjs).
 * The models are built from the envelopes the real `doctor`, `check` and
 * `stats` print, so a key renamed upstream fails here rather than rendering
 * nothing.
 */

import "./fixtures/private-homes.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAdapter } from "../src/adapter.mjs";
import { createCache, servedFromCache } from "../src/cache.mjs";
import { createServer } from "../src/server.mjs";
import { checkModel, divergentModel, doctorModel, healthSummary, HEALTH_TEXT } from "../src/view-model/health.mjs";
import { BIN, BROKEN_GUARDS, DIVERGENT_BRANCH, buildBrokenBacklog, buildHealthyBacklog } from "./fixtures/health-backlog.mjs";

let tmp;
const env = {};

/** Every string anywhere in `value`. */
function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

function isPlainData(value) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isPlainData);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return Object.values(value).every(isPlainData);
  return false;
}

function call(srv, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: srv.port, path, headers: { host: `127.0.0.1:${srv.port}` } }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, json: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    req.end();
  });
}

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "branchling-ui-health-view-"));
  const [healthy, broken] = await Promise.all([
    buildHealthyBacklog(join(tmp, "healthy")),
    buildBrokenBacklog(join(tmp, "broken")),
  ]);
  for (const [name, fixture] of [["healthy", healthy], ["broken", broken]]) {
    const adapter = createAdapter({ bin: BIN, dir: fixture.dir, cwd: fixture.root });
    const [doctor, check, stats] = await Promise.all([adapter.doctor(), adapter.check(), adapter.stats()]);
    env[name] = { fixture, adapter, doctor, check, stats };
  }
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test("a healthy backlog: every setup check and guard that ran passes, and nothing is counted as failing", () => {
  const doctor = doctorModel(env.healthy.doctor);
  const check = checkModel(env.healthy.check);
  assert.equal(doctor.state, "ready");
  assert.equal(doctor.verdict, "pass");
  assert.equal(doctor.failing, 0);
  assert.ok(!doctor.checks.some(c => c.result === "fail"));
  assert.equal(check.state, "ready");
  assert.equal(check.verdict, "pass");
  assert.equal(check.failing, 0);
  assert.deepEqual(check.failed, []);
  const summary = healthSummary({ doctor, check });
  assert.equal(summary.complete, true);
  assert.equal(summary.failing, 0);
  assert.equal(summary.badge, null, "no badge when nothing fails");
  assert.equal(summary.headline, "The setup checks and the release gate pass.");
});

test("a broken backlog: the failures are data in the ready state, listed first, and counted for the badge", () => {
  const doctor = doctorModel(env.broken.doctor);
  const check = checkModel(env.broken.check);
  // A failing check is the answer, never the error state.
  assert.equal(doctor.state, "ready");
  assert.equal(doctor.verdict, "fail");
  assert.equal(check.state, "ready");
  assert.equal(check.verdict, "fail");
  assert.deepEqual(check.failed, BROKEN_GUARDS);
  assert.deepEqual(check.guards.filter(g => g.result === "fail").map(g => g.name), BROKEN_GUARDS);
  // Failures first, in branchling's order; then passes; then what was not run.
  const results = check.guards.map(g => g.result);
  assert.deepEqual(results.slice(0, BROKEN_GUARDS.length), BROKEN_GUARDS.map(() => "fail"));
  assert.deepEqual([...results].sort((a, b) => ["fail", "pass", "not-run"].indexOf(a) - ["fail", "pass", "not-run"].indexOf(b)), results);
  assert.ok(results.includes("pass"), "positive control: some guard still passes");

  const doctorFails = doctor.checks.filter(c => c.result === "fail").map(c => c.id);
  assert.ok(doctorFails.includes("vocabulary"), "doctor's vocabulary check fails");
  assert.equal(doctor.checks[0].result, "fail", "a failure comes first");
  assert.equal(doctor.failing, doctorFails.length);

  const summary = healthSummary({ doctor, check });
  assert.equal(summary.failing, doctorFails.length + BROKEN_GUARDS.length);
  assert.deepEqual(summary.badge, { count: summary.failing, role: "danger", label: `${summary.failing} ${HEALTH_TEXT.badgeLabel}` });
  assert.equal(summary.headline, "The setup checks and the release gate fail.");
});

test("branchling's own sentences reach the model unchanged", () => {
  const doctor = doctorModel(env.broken.doctor);
  for (const raw of env.broken.doctor.checks) {
    const row = doctor.checks.find(c => c.id === raw.id);
    assert.equal(row.title, raw.title);
    assert.equal(row.detail, raw.detail);
    assert.equal(row.fix, raw.fix);
    assert.equal(row.status, raw.status);
  }
  assert.equal(doctor.next, env.broken.doctor.next);
  const check = checkModel(env.broken.check);
  for (const raw of env.broken.check.guards) {
    const row = check.guards.find(g => g.name === raw.name);
    assert.equal(row.output, raw.output.replace(/\s+$/, ""));
    assert.equal(row.severity, raw.severity);
  }
  const refs = check.guards.find(g => g.name === "refs");
  assert.match(refs.output, /TASK-99/, "the dangling reference is named in branchling's words");
});

test("a guard that was not run is its own neutral-ish state, neither pass nor fail", () => {
  const check = checkModel(env.healthy.check);
  const skipped = env.healthy.check.guards.filter(g => g.skipped === true).map(g => g.name);
  assert.ok(skipped.length > 0, "the fixture has guards branchling did not run");
  for (const name of skipped) {
    const row = check.guards.find(g => g.name === name);
    assert.equal(row.result, "not-run", name);
    assert.equal(row.resultLabel, "not run");
    assert.equal(row.role, "muted");
  }
  assert.equal(check.counts.notRun, skipped.length);
  assert.equal(check.counts.pass, check.counts.total - skipped.length, "a guard not run is not counted as passing");
  assert.equal(check.summary, `0 of ${check.counts.total - skipped.length} guards fail · ${skipped.length} not run`);
  // Positive control: a guard that ran has its own result.
  assert.equal(check.guards.find(g => g.name === "refs").result, "pass");
});

test("results get roles from branchling's verdict, and every result keeps its word", () => {
  const doctor = doctorModel(env.broken.doctor);
  const byResult = Object.fromEntries(doctor.checks.map(c => [c.result, [c.role, c.resultLabel]]));
  assert.deepEqual(byResult.fail, ["danger", "fails"]);
  assert.deepEqual(byResult.warn, ["attention", "warning"]);
  assert.deepEqual(byResult.info, ["neutral", "note"]);
  assert.deepEqual(byResult.pass, ["success", "passes"]);
  for (const row of doctor.checks) assert.ok(row.resultLabel, `${row.id} has a label`);
});

test("a doctor status this package does not know is shown as written, neutral, and never counted as a pass", () => {
  const odd = structuredClone(env.healthy.doctor);
  odd.checks.push({ id: "future", title: "a future check", status: "partial", detail: "half", fix: null });
  const model = doctorModel(odd);
  const row = model.checks.find(c => c.id === "future");
  assert.equal(row.result, "unknown");
  assert.equal(row.resultLabel, "partial");
  assert.equal(row.role, "neutral");
  assert.equal(model.counts.unknown, 1);
  assert.equal(model.counts.pass, doctorModel(env.healthy.doctor).counts.pass, "the pass count did not move");
});

test("the divergent task is listed with the branch that disagrees, in branchling's wording", () => {
  const model = divergentModel(env.broken.stats);
  assert.equal(model.state, "ready");
  assert.equal(model.count, 1);
  assert.equal(model.tasks[0].id, "TASK-3");
  const raw = env.broken.stats.divergent[0];
  assert.equal(model.tasks[0].status, raw.status);
  assert.deepEqual(model.tasks[0].elsewhere.map(o => o.source), [DIVERGENT_BRANCH]);
  assert.equal(model.tasks[0].elsewhere[0].text, `${DIVERGENT_BRANCH}: ${raw.elsewhere[0].status}`);
  // Positive control: the healthy backlog has a branch scan and nothing divergent.
  const calm = divergentModel(env.healthy.stats);
  assert.equal(calm.state, "empty");
  assert.equal(calm.scanned, true);
  assert.equal(calm.count, 0);
});

test("empty answers are empty states, and an unscanned repository is not 'nothing diverges'", () => {
  const noChecks = doctorModel({ ...env.healthy.doctor, checks: [] });
  assert.equal(noChecks.state, "empty");
  const noGuards = checkModel({ ...env.healthy.check, guards: [] });
  assert.equal(noGuards.state, "empty");
  const unscanned = divergentModel({ ...env.healthy.stats, scan: { scanned: false, reason: "not a git repository", branches: [], trees: 0 } });
  assert.equal(unscanned.scanned, false);
  assert.equal(unscanned.scanReason, "not a git repository");
  // Positive control: the real answers are not empty.
  assert.equal(doctorModel(env.healthy.doctor).state, "ready");
  assert.equal(checkModel(env.healthy.check).state, "ready");
});

test("doctor where there is no backlog: a failing verdict that says so", async () => {
  const envelope = await createAdapter({ bin: BIN, dir: join(tmp, "nowhere"), cwd: tmp }).doctor();
  const model = doctorModel(envelope);
  assert.equal(model.state, "ready");
  assert.equal(model.verdict, "fail");
  assert.equal(model.backlogFound, false);
  assert.equal(model.failing, 1);
  // Positive control.
  assert.equal(doctorModel(env.healthy.doctor).backlogFound, true);
});

test("the summary waits for both answers before it has a headline, and badges whatever has failed so far", () => {
  const broken = checkModel(env.broken.check);
  const partial = healthSummary({ doctor: null, check: broken });
  assert.equal(partial.complete, false);
  assert.equal(partial.headline, null);
  assert.equal(partial.badge.count, BROKEN_GUARDS.length);
  const nothing = healthSummary({});
  assert.equal(nothing.badge, null);
  assert.equal(nothing.failing, 0);
  // An error model is not an answer and adds nothing.
  const errored = healthSummary({ doctor: { state: "error", failing: 99 }, check: broken });
  assert.equal(errored.failing, BROKEN_GUARDS.length);
});

test("the health models are plain data, with no markup of their own and no escape codes", () => {
  const fresh = { stale: false, fetchedAt: "2026-11-02T10:00:00.000Z" };
  const models = [
    doctorModel(env.broken.doctor, fresh), checkModel(env.broken.check, fresh), divergentModel(env.broken.stats, fresh),
    healthSummary({ doctor: doctorModel(env.broken.doctor), check: checkModel(env.broken.check) }),
  ];
  // branchling's sentences are data (rendered as text, never as markup) and
  // may hold a placeholder like `<ns:name>`; every other string is the model's.
  const verbatim = new Set([
    ...env.broken.doctor.checks.flatMap(c => [c.title, c.detail, c.fix]),
    env.broken.doctor.next, env.broken.doctor.root, env.broken.check.root,
    ...env.broken.check.guards.flatMap(g => [g.output.replace(/\s+$/, ""), g.name, g.severity]),
  ].filter(Boolean));
  let own = 0;
  for (const model of models) {
    assert.ok(isPlainData(model));
    assert.deepEqual(JSON.parse(JSON.stringify(model)), model);
    for (const s of strings(model)) {
      assert.doesNotMatch(s, /\x1b/, `escape code in ${JSON.stringify(s)}`);
      if (verbatim.has(s)) continue;
      own++;
      assert.doesNotMatch(s, /<[a-z/!]/i, `markup in ${JSON.stringify(s)}`);
    }
  }
  assert.ok(own > 20, "positive control: the model has strings of its own to check");
  for (const s of strings(HEALTH_TEXT)) assert.doesNotMatch(s, /<[a-z/!]|\x1b/i);
  assert.deepEqual(models[0].freshness, fresh);
  assert.equal(doctorModel(env.broken.doctor, { stale: true }).freshness.stale, true);
});

test("anything but the right envelope is rejected instead of rendered as healthy", () => {
  assert.throws(() => doctorModel(env.healthy.check), TypeError);
  assert.throws(() => checkModel(env.healthy.doctor), TypeError);
  assert.throws(() => divergentModel(env.healthy.doctor), TypeError);
  assert.throws(() => doctorModel(null), TypeError);
  assert.throws(() => checkModel({ schemaVersion: 1, kind: "check", guards: [] }), TypeError, "no ok verdict");
});

test("the health routes answer with the envelopes unchanged, a failing verdict as 200, through the cache join", async () => {
  for (const name of ["healthy", "broken"]) {
    const { fixture, adapter } = env[name];
    const cache = createCache(adapter, { dir: fixture.dir, cwd: fixture.root });
    const server = await createServer({ adapter: servedFromCache(cache), port: 0, log: () => {} });
    try {
      const doctor = await call(server, "/api/health/doctor");
      assert.equal(doctor.status, 200, `${name} doctor`);
      assert.equal(doctor.json.kind, "doctor");
      assert.equal(doctor.json.ok, name === "healthy");
      const check = await call(server, "/api/health/check");
      assert.equal(check.status, 200, `${name} check`);
      assert.deepEqual(check.json, env[name].check);
      const divergent = await call(server, "/api/health/divergent");
      assert.equal(divergent.status, 200);
      assert.equal(divergent.json.kind, "stats");
      assert.deepEqual(divergent.json.divergent, env[name].stats.divergent);
      // stats goes through the cache and says when it was answered.
      assert.ok(divergent.headers["x-branchling-ui-fetched-at"]);
    } finally {
      await server.close();
    }
  }
});

test("a health read does not throw away the other views' cached answers", async () => {
  const { fixture, adapter } = env.healthy;
  let spawns = 0;
  const counted = { ...adapter, stats: () => { spawns++; return adapter.stats(); } };
  const cache = createCache(counted, { dir: fixture.dir, cwd: fixture.root, changes: { token: async () => "fixed" } });
  await cache.stats();
  await cache.doctor();
  await cache.check();
  await cache.stats();
  assert.equal(spawns, 1, "stats was answered from the cache after doctor and check");
  // Positive control: a write-like call does invalidate.
  await cache.raw(["stats"], "stats");
  await cache.stats();
  assert.equal(spawns, 2);
});

test("check where there is no backlog is an error response, not an empty gate", async () => {
  const adapter = createAdapter({ bin: BIN, dir: join(tmp, "nowhere"), cwd: tmp });
  const server = await createServer({ adapter, port: 0, log: () => {} });
  try {
    const check = await call(server, "/api/health/check");
    assert.equal(check.status, 500);
    assert.equal(check.json.error.type, "usage-error");
    const doctor = await call(server, "/api/health/doctor");
    assert.equal(doctor.status, 200, "positive control: doctor answers the same backlog with a verdict");
  } finally {
    await server.close();
  }
});

test("the page modules for the health view are served, and the shell links to it", async () => {
  const server = await createServer({ adapter: env.healthy.adapter, port: 0, log: () => {} });
  try {
    for (const path of ["/health.mjs", "/view-model/health.mjs"]) {
      const res = await new Promise((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `127.0.0.1:${server.port}` } }, r => { r.resume(); r.on("end", () => resolve(r)); });
        req.on("error", reject);
        req.end();
      });
      assert.equal(res.statusCode, 200, path);
      assert.match(res.headers["content-type"], /^text\/javascript/, path);
    }
    const page = await new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: server.port, path: "/", headers: { host: `127.0.0.1:${server.port}` } }, r => {
        let text = "";
        r.setEncoding("utf8");
        r.on("data", c => { text += c; });
        r.on("end", () => resolve(text));
      });
      req.on("error", reject);
      req.end();
    });
    assert.match(page, /href="\?view=health" data-view-link="health"/);
    assert.match(page, /data-view="health"/);
  } finally {
    await server.close();
  }
});
