/**
 * The plan view (UI-3) against the REAL branchling executable over fixture
 * backlogs built by that executable (test/fixtures/plan-backlog.mjs). The
 * model is built from the envelopes the real `plan`, `query` and `show`
 * print, so a key renamed upstream fails here rather than rendering nothing.
 */

import "./fixtures/private-homes.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAdapter, BranchlingRefusal } from "../src/adapter.mjs";
import { createServer } from "../src/server.mjs";
import { planModel } from "../src/view-model/plan.mjs";
import { taskDetailModel } from "../src/view-model/task.mjs";
import { TASK_ID } from "../src/views/task.mjs";
import { BIN, PLAN_RATIONALE, TITLES, WAVES, buildEmptyBacklog, buildPlanBacklog } from "./fixtures/plan-backlog.mjs";

let tmp;
let fixture;
let adapter;
let planEnvelope;
let taskList;

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

const ids = rows => rows.map(r => r.id);

function call(srv, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: srv.port, path, headers: { host: `127.0.0.1:${srv.port}` } }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(text) }));
    });
    req.on("error", reject);
    req.end();
  });
}

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "branchling-ui-plan-view-"));
  fixture = await buildPlanBacklog(join(tmp, "two-waves"));
  adapter = createAdapter({ bin: BIN, dir: fixture.dir, cwd: fixture.root });
  [planEnvelope, taskList] = await Promise.all([adapter.plan(), adapter.query()]);
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test("the real plan envelope carries every key the model reads", () => {
  assert.equal(planEnvelope.kind, "plan");
  assert.equal(planEnvelope.schemaVersion, 1);
  for (const key of ["exists", "rationale", "updated", "waves", "activeWave", "nextUp", "inProgress", "unplanned", "coverage", "stale"]) {
    assert.ok(key in planEnvelope, `plan envelope has ${key}`);
  }
  for (const key of ["index", "name", "tasks", "together", "open", "closed", "active", "endsOnHuman"]) {
    assert.ok(key in planEnvelope.waves[0], `a wave has ${key}`);
  }
  for (const key of ["id", "status", "known", "open", "executor"]) assert.ok(key in planEnvelope.waves[0].tasks[0], `a wave task has ${key}`);
  for (const key of ["together", "ids", "executors", "waitsOnHuman"]) assert.ok(key in planEnvelope.nextUp[0], `a nextUp entry has ${key}`);
  for (const key of ["open", "planned", "unplanned", "share"]) assert.ok(key in planEnvelope.coverage, `coverage has ${key}`);
  assert.equal(taskList.kind, "task-list");
  for (const key of ["id", "title", "blocked_by"]) assert.ok(key in taskList.tasks[0], `a listed task has ${key}`);
});

test("a two-wave plan: both waves in order, exactly the active one marked, the unplanned task listed", () => {
  const model = planModel(planEnvelope, {}, taskList);
  assert.equal(model.state, "ready");
  assert.deepEqual(model.waves.map(w => w.name), WAVES.map(w => w.name));
  assert.deepEqual(model.waves.map(w => w.number), [1, 2]);
  assert.deepEqual(model.waves.map(w => w.active), [true, false]);
  assert.equal(model.waves.filter(w => w.active).length, 1);
  assert.equal(model.activeWave, 0);
  assert.deepEqual(model.summary.activeWave, { index: 0, number: 1, name: "Foundation" });
  assert.deepEqual(ids(model.unplanned.tasks), ["TASK-5"]);
  assert.equal(model.unplanned.tasks[0].title, TITLES["TASK-5"]);
});

test("a planned task is not unplanned, and an unplanned task is in no wave", () => {
  const model = planModel(planEnvelope, {}, taskList);
  const unplanned = ids(model.unplanned.tasks);
  const inWaves = model.waves.flatMap(w => ids(w.tasks));
  assert.ok(inWaves.includes("TASK-3"), "positive control: TASK-3 is in a wave");
  assert.ok(!unplanned.includes("TASK-3"), "TASK-3 (wave 2) is not unplanned");
  assert.ok(unplanned.includes("TASK-5"), "positive control: TASK-5 is unplanned");
  assert.ok(!inWaves.includes("TASK-5"), "TASK-5 is in no wave");
  assert.deepEqual(model.summary.coverage, { open: 4, planned: 3, unplanned: 1, share: 25 });
  assert.equal(model.unplanned.sentence, "1 of 4 open tasks (25%) are outside every wave.");
});

test("may start now is next up without what is already in flight", () => {
  const model = planModel(planEnvelope, {}, taskList);
  // branchling lists both wave-1 tasks as next up; TASK-2 is in flight.
  assert.deepEqual(planEnvelope.nextUp.flatMap(e => e.ids), ["TASK-1", "TASK-2"]);
  assert.deepEqual(model.mayStartNow.flatMap(e => e.ids), ["TASK-1"]);
  assert.deepEqual(model.inFlightNext.flatMap(e => e.ids), ["TASK-2"]);
  assert.deepEqual(ids(model.inFlight), ["TASK-2"]);
  assert.equal(model.inFlight[0].waveName, "Foundation");
  assert.ok(!ids(model.inFlight).includes("TASK-1"), "a pending task is not in flight");
  assert.equal(model.summary.inFlight, 1);
});

test("the plan's overtaken tasks are listed, and only those", () => {
  const model = planModel(planEnvelope, {}, taskList);
  assert.deepEqual(ids(model.overtaken), ["TASK-4"]);
  assert.equal(model.overtaken[0].waveNumber, 2);
  assert.ok(!ids(model.overtaken).includes("TASK-3"), "an open wave-2 task is not overtaken");
  const row = model.waves[1].tasks.find(t => t.id === "TASK-4");
  assert.equal(row.overtaken, true);
  assert.equal(row.open, false);
  assert.equal(model.waves[1].tasks.find(t => t.id === "TASK-3").overtaken, false);
});

test("blocked_by edges come from the task list, in both directions", () => {
  const model = planModel(planEnvelope, {}, taskList);
  const roof = model.waves[1].tasks.find(t => t.id === "TASK-3");
  assert.deepEqual(roof.waitsOn, [{ id: "TASK-2", open: true }]);
  const walls = model.waves[0].tasks.find(t => t.id === "TASK-2");
  assert.deepEqual(walls.unblocks, ["TASK-3"]);
  assert.deepEqual(walls.waitsOn, []);
  assert.equal(model.dependenciesKnown, true);
});

test("wave states: active, then next; nothing finished collapses here", () => {
  const model = planModel(planEnvelope, {}, taskList);
  assert.deepEqual(model.waves.map(w => w.state), ["active", "next"]);
  assert.deepEqual(model.waves.map(w => w.collapsed), [false, false]);
  assert.deepEqual(model.waves.map(w => w.progressLabel), ["0 of 2 closed", "1 of 2 closed"]);
  assert.deepEqual(model.summary.parts, [
    "Wave 1 of 2: Foundation",
    "1 of 4 planned tasks closed",
    "1 in flight",
    "1 of 4 open tasks unplanned (25%)",
  ]);
  assert.equal(model.rationale, PLAN_RATIONALE);
});

test("every wave closed: no active wave, the summary says the plan is finished", () => {
  const closed = structuredClone(planEnvelope);
  closed.activeWave = null;
  for (const wave of closed.waves) { wave.active = false; wave.closed += wave.open; wave.open = 0; }
  const model = planModel(closed, {}, taskList);
  assert.equal(model.summary.finished, true);
  assert.equal(model.waves.filter(w => w.active).length, 0);
  assert.deepEqual(model.waves.map(w => w.state), ["closed", "closed"]);
  assert.deepEqual(model.waves.map(w => w.collapsed), [true, true]);
  assert.equal(model.summary.parts[0], "Every wave is closed (2 of 2)");
  // Positive control: the real fixture is not finished.
  assert.equal(planModel(planEnvelope, {}, taskList).summary.finished, false);
});

test("without the task list the model says dependencies are unknown, never that there are none", () => {
  const model = planModel(planEnvelope, {}, null);
  assert.equal(model.dependenciesKnown, false);
  assert.equal(model.waves[1].tasks.find(t => t.id === "TASK-3").title, null);
  // The plan's own answers do not depend on it.
  assert.deepEqual(model.waves.map(w => w.active), [true, false]);
  assert.deepEqual(ids(model.unplanned.tasks), ["TASK-5"]);
});

test("no plan at all is the empty state, not an error", async () => {
  const empty = await buildEmptyBacklog(join(tmp, "no-plan"));
  const envelope = await createAdapter({ bin: BIN, dir: empty.dir, cwd: empty.root }).plan();
  assert.equal(envelope.exists, false);
  const model = planModel(envelope);
  assert.equal(model.state, "empty");
  assert.equal(model.emptyReason, "no-plan");
  // Positive control: the same builder answers "ready" for the fixture.
  assert.equal(planModel(planEnvelope).state, "ready");
});

test("a plan with no waves yet is the empty state too", async () => {
  const bare = await buildEmptyBacklog(join(tmp, "no-waves"));
  writeFileSync(join(bare.dir, "plan.yaml"), "rationale: \"Not decided yet.\"\nwaves:\n");
  const envelope = await createAdapter({ bin: BIN, dir: bare.dir, cwd: bare.root }).plan();
  assert.equal(envelope.exists, true);
  const model = planModel(envelope);
  assert.equal(model.state, "empty");
  assert.equal(model.emptyReason, "no-waves");
});

test("the plan model is plain data, with no markup and no escape codes", () => {
  const model = planModel(planEnvelope, { stale: false, fetchedAt: "2026-11-02T10:00:00.000Z" }, taskList);
  assert.ok(isPlainData(model));
  assert.deepEqual(JSON.parse(JSON.stringify(model)), model);
  assert.deepEqual(model.freshness, { stale: false, fetchedAt: "2026-11-02T10:00:00.000Z" });
  const all = strings(model);
  assert.ok(all.length > 20, "positive control: the model has strings to check");
  for (const s of all) {
    assert.doesNotMatch(s, /<[a-z/!]/i, `markup in ${JSON.stringify(s)}`);
    assert.doesNotMatch(s, /\x1b/, `escape code in ${JSON.stringify(s)}`);
  }
  for (const row of model.waves.flatMap(w => w.tasks)) assert.equal(row.role, "neutral");
});

test("anything but a plan envelope is rejected instead of rendered as no plan", () => {
  assert.throws(() => planModel({ schemaVersion: 1, kind: "stats" }), TypeError);
  assert.throws(() => planModel(null), TypeError);
  assert.throws(() => planModel(planEnvelope, {}, { kind: "plan" }), TypeError);
});

test("the detail model reads branchling's own blocked verdict from show", async () => {
  const roof = taskDetailModel(await adapter.show("TASK-3"));
  assert.equal(roof.id, "TASK-3");
  assert.equal(roof.title, TITLES["TASK-3"]);
  assert.equal(roof.blocked, true);
  assert.deepEqual(roof.blockers.map(b => [b.id, b.resolved, b.found]), [["TASK-2", false, true]]);
  // Positive control: a task with no blocker is not blocked.
  const foundation = taskDetailModel(await adapter.show("TASK-1"));
  assert.equal(foundation.blocked, false);
  assert.deepEqual(foundation.blockers, []);
  assert.ok(isPlainData(roof));
  for (const s of strings(roof)) assert.doesNotMatch(s, /<[a-z/!]|\x1b/i);
  assert.throws(() => taskDetailModel(planEnvelope), TypeError);
});

test("the task id parameter accepts ids and refuses flags and junk", () => {
  for (const id of ["TASK-1", "UI-3", "TL-521", "BL_X-42"]) assert.match(id, TASK_ID, id);
  for (const id of ["", "--help", "-1", "TASK-", "TASK-1 --dir /", "TASK-1\n", "../TASK-1", "TASK-1;rm"]) assert.doesNotMatch(id, TASK_ID, JSON.stringify(id));
});

test("the plan routes answer from the real executable, and a bad id costs no spawn", async () => {
  let shows = 0;
  const counted = { ...adapter, show: id => { shows++; return adapter.show(id); } };
  const server = await createServer({ adapter: counted, port: 0, log: () => {} });
  try {
    const plan = await call(server, "/api/plan");
    assert.equal(plan.status, 200);
    assert.deepEqual(plan.json, planEnvelope);
    const tasks = await call(server, "/api/plan/tasks");
    assert.equal(tasks.status, 200);
    assert.equal(tasks.json.kind, "task-list");

    for (const path of ["/api/task", "/api/task?id=", "/api/task?id=--help", "/api/task?id=TASK-1%20--json"]) {
      const res = await call(server, path);
      assert.equal(res.status, 400, path);
      assert.equal(res.json.error.type, "bad-request", path);
    }
    assert.equal(shows, 0, "no bad request reached the adapter");

    const shown = await call(server, "/api/task?id=TASK-3");
    assert.equal(shown.status, 200);
    assert.equal(shown.json.kind, "task-show");
    assert.equal(shown.json.id, "TASK-3");
    assert.equal(shows, 1, "positive control: a good id does reach it");

    const missing = await call(server, "/api/task?id=TASK-99");
    assert.equal(missing.status, 409);
    assert.equal(missing.json.error.type, "refusal");
    assert.equal(missing.json.error.envelope.kind, "task-show");
  } finally {
    await server.close();
  }
});

test("an unknown id is a refusal from the adapter, which the route passes on", async () => {
  await assert.rejects(adapter.show("TASK-99"), err => err instanceof BranchlingRefusal && err.envelope.kind === "task-show");
});

test("the page modules for the plan view are served", async () => {
  const server = await createServer({ adapter, port: 0 });
  try {
    for (const path of ["/plan.mjs", "/view-model/plan.mjs"]) {
      const res = await new Promise((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: server.port, path, headers: { host: `127.0.0.1:${server.port}` } }, r => { r.resume(); r.on("end", () => resolve(r)); });
        req.on("error", reject);
        req.end();
      });
      assert.equal(res.statusCode, 200, path);
      assert.match(res.headers["content-type"], /^text\/javascript/, path);
    }
  } finally {
    await server.close();
  }
});
