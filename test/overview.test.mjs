/**
 * The overview (UI-29), the default view, against the REAL branchling
 * executable over fixture backlogs built by that executable
 * (test/fixtures/overview-backlog.mjs), through the real server with UI-2's
 * cache joined as bin/branchling-ui.mjs joins it. Requests go through
 * node:http, because fetch cannot set the Host header the server's guard
 * judges. Each test reads the routes in OVERVIEW_READS and builds the model
 * exactly as the page does (overviewPart, then overviewModel).
 *
 * The fixture: TASK-5 asked a question; INDEX.yaml is staged in git, so
 * doctor's `git-tracked` check fails; wave 1 "Foundation" is active with
 * TASK-1 startable and TASK-2 in flight; TASK-3 is blocked_by TASK-2.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BranchlingRefusal, BranchlingUsageError, createAdapter } from "../src/adapter.mjs";
import { createCache, servedFromCache } from "../src/cache.mjs";
import { createServer } from "../src/server.mjs";
import { views } from "../src/views/index.mjs";
import { OVERVIEW_LIST_LIMIT, OVERVIEW_READS, OVERVIEW_TEXT, overviewLoading, overviewModel, overviewPart } from "../src/view-model/overview.mjs";
import { BIN, FAILING_CHECK, QUESTION, QUESTION_TASK, buildEmptyOverviewBacklog, buildOverviewBacklog } from "./fixtures/overview-backlog.mjs";

let tmp;
let fixture;
let emptyFixture;
const servers = [];
/** The fixture's real doctor envelope, read once: doctor is the slow read. */
let doctorEnvelope;

function call(srv, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: srv.port, path, headers: { host: `127.0.0.1:${srv.port}` } }, res => {
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

/**
 * The server as bin/branchling-ui.mjs builds it. `change` replaces adapter
 * methods (a read that throws) before the cache wraps them, as a broken
 * branchling would.
 */
async function serve(fx, change = {}) {
  const adapter = { ...createAdapter({ bin: BIN, dir: fx.dir, cwd: fx.root }), ...change };
  const served = servedFromCache(createCache(adapter, { dir: fx.dir, cwd: fx.root }));
  const srv = await createServer({ adapter: served, port: 0, log: () => {} });
  servers.push(srv);
  return srv;
}

/** What the page does: every read in parallel, each answer made a part. */
async function readParts(srv) {
  const names = Object.keys(OVERVIEW_READS);
  const answers = await Promise.all(names.map(name => call(srv, OVERVIEW_READS[name])));
  const parts = {};
  const statuses = {};
  names.forEach((name, i) => {
    const res = answers[i];
    statuses[name] = res.status;
    parts[name] = overviewPart({ ok: res.status >= 200 && res.status < 300, status: res.status, body: res.json });
  });
  return { parts, statuses };
}

const partsOf = model => Object.fromEntries([...model.needs, model.wave, model.inFlight, model.totals].map(p => [p.key, p]));

function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

function assertPlain(model, where) {
  for (const s of strings(model)) {
    assert.doesNotMatch(s, /<[a-z/!]/i, `${where}: markup in ${JSON.stringify(s)}`);
    assert.doesNotMatch(s, /\x1b/, `${where}: an escape code in ${JSON.stringify(s)}`);
  }
}

let ready;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "branchling-ui-overview-"));
  fixture = await buildOverviewBacklog(join(tmp, "overview"));
  emptyFixture = await buildEmptyOverviewBacklog(join(tmp, "empty"));
  const srv = await serve(fixture);
  const { parts, statuses } = await readParts(srv);
  for (const [name, status] of Object.entries(statuses)) assert.equal(status, 200, `${name}: ${JSON.stringify(parts[name])}`);
  doctorEnvelope = parts.doctor.envelope;
  ready = { parts, model: overviewModel(parts, {}, Date.now()) };
});

after(async () => {
  for (const srv of servers) await srv.close();
  rmSync(tmp, { recursive: true, force: true });
});

// --- the acceptance criterion ------------------------------------------------------

test("the overview shows the open question, the failing check and the active wave", () => {
  const p = partsOf(ready.model);
  assert.equal(ready.model.state, "ready");

  assert.equal(p.questions.state, "ready");
  assert.equal(p.questions.count, 1);
  assert.deepEqual(p.questions.lines.map(l => [l.id, l.text]), [[QUESTION_TASK, QUESTION]]);
  assert.deepEqual(p.questions.badge, { label: "1 open question", role: "attention" });
  assert.equal(p.questions.link.href, "?view=decisions");

  assert.equal(p.checks.state, "ready");
  assert.ok(p.checks.count >= 1);
  const failing = ready.parts.doctor.envelope.checks.filter(c => c.status === "error").map(c => c.id);
  assert.ok(failing.includes(FAILING_CHECK), `doctor fails ${FAILING_CHECK}: ${failing}`);
  assert.equal(p.checks.count, failing.length, "the count is doctor's own error rows");
  assert.ok(p.checks.lines.some(l => l.label === "views out of the index" && /INDEX\.yaml/.test(l.text)));
  assert.equal(p.checks.badge.role, "danger");
  assert.equal(p.checks.link.href, "?view=health");

  assert.equal(p.wave.state, "ready");
  assert.deepEqual(p.wave.activeWave, { index: 0, number: 1, name: "Foundation" });
  assert.equal(p.wave.badge.label, "Wave 1 of 2");
  assert.equal(p.wave.title, "1 task may start now");
  assert.deepEqual(p.wave.lines.map(l => [l.id, l.text]), [["TASK-1", "Foundation is laid"]]);
  assert.equal(p.wave.link.href, "?view=plan");
});

test("what is in flight comes from the status the plan names, with its holder", () => {
  const p = partsOf(ready.model);
  assert.equal(ready.parts.plan.envelope.inProgressStatus, "in_progress");
  assert.equal(p.inFlight.state, "ready");
  assert.deepEqual(p.inFlight.rows.map(r => [r.id, r.title, r.owner]), [["TASK-2", "Walls stand", "agent:fixture"]]);
  assert.equal(p.inFlight.rows[0].href, "?view=tasks&task=TASK-2");
  assert.equal(p.inFlight.link.href, "?view=tasks&status=in_progress");
  // Positive control: the task that may start now is not listed as in flight.
  assert.ok(!p.inFlight.rows.some(r => r.id === "TASK-1"));
});

test("waiting on other tasks is stats `blocked` (a blocked_by), not the status named blocked", () => {
  const p = partsOf(ready.model);
  const stats = ready.parts.stats.envelope.stats;
  // The fixture holds one of each: TASK-5 has the status `blocked` (ask set it),
  // TASK-3 has a blocked_by and its own status.
  assert.equal(stats.byStatus.blocked, 1);
  assert.equal(stats.blocked, 1);
  assert.equal(p.blocked.count, stats.blocked);
  assert.deepEqual(p.blocked.lines.map(l => l.id), ["TASK-3"]);
  assert.match(p.blocked.lines[0].text, /waits on TASK-2/);
  assert.ok(!p.blocked.lines.some(l => l.id === QUESTION_TASK), "the task with the status blocked is not listed here");
  assert.equal(p.blocked.note, OVERVIEW_TEXT.blockedNote);
  const tile = p.totals.tiles.find(t => t.key === "blocked");
  assert.equal(tile.value, String(stats.blocked));
});

test("the totals and distributions are the stats envelope's, linking to the filtered task list", () => {
  const p = partsOf(ready.model);
  const stats = ready.parts.stats.envelope.stats;
  assert.equal(p.totals.state, "ready");
  assert.equal(p.totals.tiles.find(t => t.key === "active").value, String(stats.active));
  assert.equal(p.totals.tiles.find(t => t.key === "active").note, `of ${stats.total} tasks`);
  assert.equal(p.totals.tiles.find(t => t.key === "openHours").value, String(stats.openHours.hours));
  assert.deepEqual(p.totals.byStatus.map(r => [r.key, r.count]), Object.entries(stats.byStatus));
  const pending = p.totals.byStatus.find(r => r.key === "pending");
  assert.equal(pending.href, "?view=tasks&status=pending");
  assert.equal(pending.share, Math.round((stats.byStatus.pending / stats.total) * 100));
  assert.deepEqual(p.totals.byPriority.map(r => [r.key, r.count, r.href]), [["P1", stats.byPriority.P1, "?view=tasks&priority=P1"]]);
});

// --- one failing read --------------------------------------------------------------

test("a failing doctor leaves every other part shown, the checks part in its error state", async () => {
  const srv = await serve(fixture, {
    doctor: async () => { throw new BranchlingUsageError(["doctor", "--json"], 2, "simulated: doctor crashed"); },
  });
  const { parts, statuses } = await readParts(srv);
  assert.equal(statuses.doctor, 500);
  assert.equal(statuses.stats, 200, "positive control: the other reads answered");
  const p = partsOf(overviewModel(parts, {}, Date.now()));
  assert.equal(p.checks.state, "error");
  assert.equal(p.checks.source, "doctor");
  assert.equal(p.checks.failure.errorType, "usage-error");
  assert.equal(p.checks.failure.title, "The interface called branchling incorrectly");
  assert.match(p.checks.failure.detail, /simulated: doctor crashed/);
  assert.equal(p.checks.failure.httpStatus, 500);
  for (const key of ["questions", "blocked", "wave", "inFlight", "totals"]) assert.equal(p[key].state, "ready", key);
  assert.equal(p.questions.lines[0].text, QUESTION);
  assert.equal(p.wave.activeWave.name, "Foundation");
});

test("a refused plan leaves the questions, checks and totals shown, the wave and in-flight parts refused", async () => {
  const srv = await serve(fixture, {
    plan: async () => { throw new BranchlingRefusal({ refusalKind: "no-plan", refusal: "simulated: the plan cannot be read" }, 1); },
    doctor: async () => doctorEnvelope,
  });
  const { parts, statuses } = await readParts(srv);
  assert.equal(statuses.plan, 409);
  const p = partsOf(overviewModel(parts, {}, Date.now()));
  for (const key of ["wave", "inFlight"]) {
    assert.equal(p[key].state, "refusal", key);
    assert.equal(p[key].failure.refusalKind, "no-plan");
    assert.equal(p[key].failure.detail, "simulated: the plan cannot be read");
  }
  for (const key of ["questions", "checks", "blocked", "totals"]) assert.equal(p[key].state, "ready", key);
  assert.ok(p.checks.lines.some(l => l.label === "views out of the index"));
});

test("a read that never answered is an error naming the unreachable server, never an empty part", () => {
  const parts = { ...ready.parts, decisions: overviewPart({ unreachable: true, message: "connection refused" }) };
  const p = partsOf(overviewModel(parts, {}, Date.now()));
  assert.equal(p.questions.state, "error");
  assert.equal(p.questions.failure.title, "The local server cannot be reached");
  assert.equal(p.questions.failure.detail, "connection refused");
  assert.equal(p.checks.state, "ready");
});

test("an answer of the wrong shape is a contract fault for its parts only", () => {
  const parts = { ...ready.parts, stats: overviewPart({ ok: true, status: 200, body: { kind: "plan" } }) };
  const p = partsOf(overviewModel(parts, {}, Date.now()));
  for (const key of ["blocked", "totals"]) {
    assert.equal(p[key].state, "error", key);
    assert.equal(p[key].failure.errorType, "contract-mismatch");
  }
  assert.equal(p.questions.state, "ready");
});

// --- loading and empty -------------------------------------------------------------

test("each part is loading until its own reads have answered", () => {
  const all = overviewLoading();
  assert.equal(all.state, "loading");
  for (const part of Object.values(partsOf(all))) assert.equal(part.state, "loading", part.key);

  // Only stats has answered: the totals and the waiting count are shown, the rest waits.
  const some = overviewModel({ stats: ready.parts.stats }, {}, Date.now());
  const p = partsOf(some);
  assert.equal(some.state, "ready");
  assert.equal(p.totals.state, "ready");
  assert.equal(p.blocked.state, "ready");
  for (const key of ["questions", "checks", "wave", "inFlight"]) assert.equal(p[key].state, "loading", key);
  // In flight needs both the plan and the task list.
  assert.equal(partsOf(overviewModel({ plan: ready.parts.plan }, {})).inFlight.state, "loading");
});

test("an empty backlog shows every part's empty state, not an error", async () => {
  const srv = await serve(emptyFixture);
  const { parts, statuses } = await readParts(srv);
  for (const [name, status] of Object.entries(statuses)) assert.equal(status, 200, `${name}: ${JSON.stringify(parts[name])}`);
  const model = overviewModel(parts, {}, Date.now());
  const p = partsOf(model);
  for (const key of ["questions", "blocked", "wave", "inFlight", "totals"]) assert.equal(p[key].state, "empty", key);
  assert.equal(p.wave.title, OVERVIEW_TEXT.waveNoPlan);
  assert.equal(p.totals.title, OVERVIEW_TEXT.totalsEmpty);
  assert.notEqual(p.checks.state, "error");
  assert.ok(!(p.checks.lines || []).some(l => l.label === "views out of the index"), "nothing staged, so git-tracked does not fail");
  assertPlain(model, "empty");
});

// --- the page --------------------------------------------------------------------

test("the overview is the default view and its reads are existing routes", async () => {
  const app = readFileSync(new URL("../src/web/app.mjs", import.meta.url), "utf8");
  assert.match(app, /^\s*overview: "\/overview\.mjs",$/m);
  assert.match(app, /: "overview";$/m, "no view, or an unknown one, falls back to the overview");
  assert.match(app, /requested === "stats"/, "the folded stats view stays reachable by its address");

  const html = readFileSync(new URL("../src/web/index.html", import.meta.url), "utf8");
  assert.equal((html.match(/data-view-link="overview"/g) || []).length, 1);
  assert.match(html, /<a href="\?view=overview" data-view-link="overview">/);
  assert.equal((html.match(/data-view="overview"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-view-link="stats"/, "the nav links the overview, not the stats it folds in");
  assert.match(html, /<section aria-labelledby="stats-title" data-view="stats" hidden>/);
  assert.ok(html.indexOf('data-view="overview"') < html.indexOf('data-view="stats"'));

  const page = readFileSync(new URL("../src/web/overview.mjs", import.meta.url), "utf8");
  assert.match(page, /export function start\(section\)/);
  assert.doesNotMatch(page, /innerHTML/);
  assert.match(page, /role: "alert"/);

  const routes = new Set(views.flatMap(v => v.routes.filter(r => r.method === "GET").map(r => r.path)));
  for (const [name, path] of Object.entries(OVERVIEW_READS)) assert.ok(routes.has(path), `${name}: ${path} is a GET route`);

  const srv = servers[0];
  for (const path of ["/overview.mjs", "/view-model/overview.mjs"]) assert.equal((await call(srv, path)).status, 200, path);
  const served = await call(srv, "/");
  assert.match(served.text, /id="overview"/);
});

test("the overview model is plain data: no markup, no escape codes, sibling imports only", () => {
  assertPlain(ready.model, "ready");
  assertPlain(overviewLoading(), "loading");
  assertPlain(OVERVIEW_TEXT, "OVERVIEW_TEXT");
  assert.ok(OVERVIEW_LIST_LIMIT > 0);
  const source = readFileSync(new URL("../src/view-model/overview.mjs", import.meta.url), "utf8");
  for (const m of source.matchAll(/^import .* from "([^"]+)";$/gm)) assert.match(m[1], /^\.\/[a-z-]+\.mjs$/, m[1]);
  assert.doesNotMatch(source, /\bdocument\.|\bwindow\.|from "node:/);
});
