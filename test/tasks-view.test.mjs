/**
 * The tasks view (UI-26) against the REAL branchling executable over fixture
 * backlogs built by that executable (test/fixtures/tasks-backlog.mjs), through
 * the real server with UI-2's cache joined as bin/branchling-ui.mjs joins it.
 * Requests go through node:http, because fetch cannot set the Host header the
 * server's guard judges.
 */

import "./fixtures/private-homes.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAdapter } from "../src/adapter.mjs";
import { createCache, servedFromCache } from "../src/cache.mjs";
import { createServer } from "../src/server.mjs";
import { views } from "../src/views/index.mjs";
import {
  FILTER_MAX_LENGTH, TASK_FILTER_KEYS, TASKS_TEXT,
  activeFieldFilterCount, filtersSummaryText, parseTaskFilters, parseTaskSelection, tasksFailure, tasksHref, tasksLoading, tasksModel, validateTaskFilters, writeTaskFilters,
} from "../src/view-model/tasks.mjs";
import { BIN, TASKS, buildTasksBacklog } from "./fixtures/tasks-backlog.mjs";
import { buildEmptyBacklog } from "./fixtures/plan-backlog.mjs";

let tmp;
let fixture;
let server;
let calls;
let emptyFixture;
let emptyServer;

const ACTIVE = TASKS.filter(t => t.status !== "done").map(t => t.id);
const ids = rows => rows.map(r => r.id).sort();
const expect = pred => TASKS.filter(pred).map(t => t.id).sort();
const activeWhere = pred => expect(t => t.status !== "done" && pred(t));

function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

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

/** The server as bin/branchling-ui.mjs builds it, counting every spawn of `query`. */
async function serve(fx, counter) {
  const adapter = createAdapter({ bin: BIN, dir: fx.dir, cwd: fx.root });
  const counted = { ...adapter, query: (...args) => { counter.query++; return adapter.query(...args); } };
  const cached = servedFromCache(createCache(counted, { dir: fx.dir, cwd: fx.root }));
  return createServer({ adapter: cached, port: 0, log: () => {} });
}

const listed = async path => {
  const res = await call(server, path);
  assert.equal(res.status, 200, `${path}: ${res.text}`);
  assert.equal(res.json.kind, "task-list");
  return res.json;
};

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "branchling-ui-tasks-view-"));
  fixture = await buildTasksBacklog(join(tmp, "tasks"));
  calls = { query: 0 };
  server = await serve(fixture, calls);
  emptyFixture = await buildEmptyBacklog(join(tmp, "empty"));
  emptyServer = await serve(emptyFixture, { query: 0 });
});

after(async () => {
  await server?.close();
  await emptyServer?.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("the tasks view is registered once, in alphabetical order", () => {
  const order = views.map(v => v.id);
  assert.ok(order.includes("tasks"));
  assert.deepEqual(order, [...order].sort());
  const routes = views.flatMap(v => v.routes.map(r => `${r.method} ${r.path}`));
  assert.equal(routes.filter(r => r === "GET /api/tasks").length, 1);
});

test("the page has one Tasks link, one tasks section and one VIEW_MODULES line", () => {
  const html = readFileSync(new URL("../src/web/index.html", import.meta.url), "utf8");
  assert.equal((html.match(/data-view-link="tasks"/g) || []).length, 1);
  assert.match(html, /<a href="\?view=tasks" data-view-link="tasks">/);
  assert.equal((html.match(/data-view="tasks"/g) || []).length, 1);
  const app = readFileSync(new URL("../src/web/app.mjs", import.meta.url), "utf8");
  assert.match(app, /^\s*tasks: "\/tasks\.mjs",$/m);
  const page = readFileSync(new URL("../src/web/tasks.mjs", import.meta.url), "utf8");
  assert.match(page, /export function start\(section\)/);
  assert.doesNotMatch(page, /innerHTML/);
  for (const api of ["pushState", "replaceState", "popstate"]) assert.match(page, new RegExp(api));
  // The field filters fold into a <details> whose summary text comes from the model.
  assert.match(page, /el\("details", \{ class: "task-filters" \}/);
  assert.match(page, /matchMedia\("\(min-width: 640px\)"\)/);
  assert.match(page, /filtersSummaryText\(/);
  assert.doesNotMatch(page, /"Filters ·/, "the summary text is not hard-coded in the page");
});

test("the Filters summary counts the active field filters, never the search text", () => {
  assert.equal(activeFieldFilterCount({}), 0);
  assert.equal(activeFieldFilterCount({ text: "refunds" }), 0);
  assert.equal(activeFieldFilterCount({ text: "x", status: "pending", label: "ui" }), 2);
  assert.equal(activeFieldFilterCount({ status: "  ", owner: "local:maja" }), 1);
  assert.equal(activeFieldFilterCount(null), 0);
  assert.equal(filtersSummaryText({}), "Filters");
  assert.equal(filtersSummaryText({ text: "a" }), "Filters");
  assert.equal(filtersSummaryText({ status: "pending", priority: "P1" }), "Filters · 2 active");
  const all = Object.fromEntries(TASK_FILTER_KEYS.map(k => [k, "v"]));
  assert.equal(activeFieldFilterCount(all), TASK_FILTER_KEYS.length - 1);
  const env = { schemaVersion: 1, kind: "task-list", tasks: [], total: 0, limit: null };
  assert.equal(tasksModel(env, { epic: "Billing", text: "a" }).filtersSummary, "Filters · 1 active");
  assert.equal(tasksModel(env).filtersSummary, TASKS_TEXT.filtersSummary(0));
});

test("the full list: the active tasks, the archived one left out, every key the model reads", async () => {
  const envelope = await listed("/api/tasks");
  assert.deepEqual(envelope.tasks.map(t => t.id).sort(), [...ACTIVE].sort());
  assert.ok(!envelope.tasks.some(t => t.id === "TASK-5"), "the done task is archived, not listed by default");
  for (const key of ["id", "title", "status", "priority", "board", "epic", "owner", "labels", "blocked_by"]) {
    assert.ok(key in envelope.tasks[0], `a listed task has ${key}`);
  }
  assert.ok("total" in envelope && "limit" in envelope);
  const model = tasksModel(envelope);
  assert.equal(model.state, "ready");
  assert.equal(model.scope.kind, "active");
  assert.equal(model.scope.text, TASKS_TEXT.scopeActive);
  assert.equal(model.count.text, `${ACTIVE.length} tasks`);
  const one = model.rows.find(r => r.id === "TASK-1");
  assert.deepEqual(
    { title: one.title, status: one.statusLabel, priority: one.priority, owner: one.owner, board: one.board, epic: one.epic, labels: one.labels },
    { title: TASKS[0].title, status: "in progress", priority: "P0", owner: "agent:fixture", board: "main", epic: "Billing", labels: ["ui"] },
  );
  assert.equal(one.href, "?view=tasks&task=TASK-1");
  assert.equal(one.statusRole, "neutral");
  assert.equal(one.priorityRole, "neutral");
});

test("the status filter narrows to the statuses named, and reaches an archived one", async () => {
  const pending = await listed("/api/tasks?status=pending");
  assert.deepEqual(ids(pending.tasks), activeWhere(t => t.status === "pending"));
  assert.ok(ids(pending.tasks).length < ACTIVE.length, "positive control: it narrowed");
  const done = await listed("/api/tasks?status=done");
  assert.deepEqual(ids(done.tasks), ["TASK-5"]);
  const two = await listed("/api/tasks?status=pending,blocked");
  assert.deepEqual(ids(two.tasks), activeWhere(t => ["pending", "blocked"].includes(t.status)));
  const model = tasksModel(done, { status: "done" });
  assert.equal(model.scope.kind, "status");
  assert.equal(model.scope.text, "Showing tasks with status done.");
});

test("the priority filter narrows", async () => {
  const p2 = await listed("/api/tasks?priority=P2");
  assert.deepEqual(ids(p2.tasks), activeWhere(t => t.priority === "P2"));
  assert.equal(ids(p2.tasks).length, 2);
  const p0 = await listed("/api/tasks?priority=P0");
  assert.deepEqual(ids(p0.tasks), ["TASK-1"]);
});

test("the board filter: the one board lists everything, an undeclared board is rejected, never empty", async () => {
  const main = await listed("/api/tasks?board=main");
  assert.deepEqual(ids(main.tasks), [...ACTIVE].sort());
  const before = calls.query;
  const res = await call(server, "/api/tasks?board=nowhere");
  assert.equal(res.status, 422);
  assert.equal(res.json.error.type, "rejected-input");
  assert.deepEqual(res.json.error.input, { board: "nowhere" });
  assert.equal(calls.query, before + 1, "branchling was asked");
  const model = tasksFailure(res.json, res.status);
  assert.equal(model.state, "rejected");
  assert.match(model.title, /nowhere/);
});

test("an unknown status or priority is rejected-input too, not an interface bug", async () => {
  for (const [key, value] of [["status", "shipped"], ["priority", "P9"]]) {
    const res = await call(server, `/api/tasks?${key}=${value}`);
    assert.equal(res.status, 422, `${key}=${value}`);
    assert.deepEqual(res.json.error.input, { [key]: value });
  }
});

test("the epic filter narrows", async () => {
  const billing = await listed("/api/tasks?epic=Billing");
  assert.deepEqual(ids(billing.tasks), activeWhere(t => t.epic === "Billing"));
  const platform = await listed("/api/tasks?epic=Platform");
  assert.deepEqual(ids(platform.tasks), activeWhere(t => t.epic === "Platform"));
  assert.ok(!ids(platform.tasks).includes("TASK-5"), "the archived Platform task stays out");
});

test("the owner filter narrows", async () => {
  const maja = await listed("/api/tasks?owner=local%3Amaja");
  assert.deepEqual(ids(maja.tasks), ["TASK-6"]);
  const agent = await listed("/api/tasks?owner=agent%3Afixture");
  assert.deepEqual(ids(agent.tasks), ["TASK-1"]);
  const nobody = await listed("/api/tasks?owner=human%3Anobody");
  assert.deepEqual(nobody.tasks, []);
});

test("the label filter narrows", async () => {
  const ui = await listed("/api/tasks?label=ui");
  assert.deepEqual(ids(ui.tasks), activeWhere(t => t.labels.includes("ui")));
  const api = await listed("/api/tasks?label=api");
  assert.deepEqual(ids(api.tasks), activeWhere(t => t.labels.includes("api")));
});

test("the text filter narrows by id or title", async () => {
  const refunds = await listed("/api/tasks?text=refunds");
  assert.deepEqual(ids(refunds.tasks), ["TASK-2"]);
  const byId = await listed("/api/tasks?text=TASK-4");
  assert.deepEqual(ids(byId.tasks), ["TASK-4"]);
});

test("filters combine as AND; a combination that matches nothing is the no-match empty", async () => {
  const both = await listed("/api/tasks?epic=Platform&label=ui");
  assert.deepEqual(ids(both.tasks), ["TASK-3"]);
  const none = await listed("/api/tasks?epic=Billing&priority=P3");
  assert.deepEqual(none.tasks, []);
  const model = tasksModel(none, { epic: "Billing", priority: "P3" });
  assert.equal(model.state, "empty");
  assert.equal(model.emptyKind, "no-match");
  assert.equal(model.emptyText, TASKS_TEXT.emptyNoMatch);
  assert.equal(model.clearHref, "?view=tasks");
});

test("a value that looks like a flag, or is malformed, is a 400 and spawns nothing", async () => {
  // Positive control: a good request spawns (on a key not read before).
  const first = calls.query;
  await listed("/api/tasks?text=dunning");
  assert.equal(calls.query, first + 1);
  const bad = [
    "/api/tasks?status=--help",
    "/api/tasks?text=-x",
    "/api/tasks?label=ui,--count",
    "/api/tasks?owner=%2D%2Djson",
    "/api/tasks?epic=a%0Ab",
    `/api/tasks?text=${"a".repeat(FILTER_MAX_LENGTH + 1)}`,
  ];
  for (const path of bad) {
    const before = calls.query;
    const res = await call(server, path);
    assert.equal(res.status, 400, path);
    assert.equal(res.json.error.type, "bad-request", path);
    assert.equal(calls.query, before, `${path} spawned nothing`);
    assert.equal(tasksFailure(res.json, res.status).state, "error");
  }
});

test("an unknown parameter is ignored, not passed to branchling", async () => {
  const res = await listed("/api/tasks?sort=--help&view=tasks");
  assert.deepEqual(ids(res.tasks), [...ACTIVE].sort());
});

test("the empty backlog is its own empty state, not the no-match one", async () => {
  const res = await call(emptyServer, "/api/tasks");
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.tasks, []);
  const stats = await call(emptyServer, "/api/stats");
  const model = tasksModel(res.json, {}, {}, { stats: stats.json });
  assert.equal(model.state, "empty");
  assert.equal(model.emptyKind, "no-tasks");
  assert.equal(model.emptyText, TASKS_TEXT.emptyNoTasks);
  // Without stats, nothing says the backlog is empty: only that nothing is active.
  assert.equal(tasksModel(res.json).emptyKind, "no-active");
});

test("the values offered come from the answers, widened by the stats keys", async () => {
  const envelope = await listed("/api/tasks?status=pending");
  const narrow = tasksModel(envelope, { status: "pending" });
  assert.deepEqual(narrow.options.status, ["pending"]);
  const stats = (await call(server, "/api/stats")).json;
  const wide = tasksModel(envelope, { status: "pending" }, {}, { stats });
  for (const status of ["pending", "in_progress", "blocked", "done"]) assert.ok(wide.options.status.includes(status), status);
  assert.ok(wide.options.epic.includes("Platform"));
  assert.ok(!wide.options.epic.includes("—"), "stats' placeholder for no epic is not a value");
  assert.ok(wide.options.owner.includes("local:maja"));
  assert.ok(wide.options.label.includes("api"));
});

test("every filter survives a URL round trip, alone and together", () => {
  const samples = {
    text: "Refunds need",
    status: "pending,blocked",
    priority: "P1",
    board: "main",
    epic: "Billing & co",
    owner: "local:maja",
    label: "gdpr",
  };
  for (const key of TASK_FILTER_KEYS) {
    const one = { [key]: samples[key] };
    assert.deepEqual(parseTaskFilters(new URLSearchParams(writeTaskFilters(one))), one, key);
    const href = tasksHref(one);
    assert.ok(href.startsWith("?view=tasks&"), href);
    const params = new URLSearchParams(href);
    assert.equal(params.get("view"), "tasks");
    assert.deepEqual(parseTaskFilters(params), one, `${key} through the page URL`);
  }
  const all = { ...samples };
  assert.deepEqual(parseTaskFilters(new URLSearchParams(writeTaskFilters(all))), all);
  assert.equal(writeTaskFilters(all), "text=Refunds+need&status=pending%2Cblocked&priority=P1&board=main&epic=Billing+%26+co&owner=local%3Amaja&label=gdpr");
  const withTask = new URLSearchParams(tasksHref(all, "TASK-3"));
  assert.deepEqual(parseTaskFilters(withTask), all);
  assert.equal(parseTaskSelection(withTask), "TASK-3");
  assert.deepEqual(parseTaskFilters(new URLSearchParams("")), {});
  assert.equal(tasksHref({}), "?view=tasks");
});

test("parsing drops unknown keys and empty values, and trims", () => {
  const params = new URLSearchParams("view=tasks&status=%20pending%20&owner=&sort=id&task=--help");
  assert.deepEqual(parseTaskFilters(params), { status: "pending" });
  assert.equal(parseTaskSelection(params), null, "a task that is not an id is no selection");
  assert.deepEqual(writeTaskFilters({ status: "", nope: "x", label: " ui " }), "label=ui");
});

test("validateTaskFilters accepts plain values and refuses flags, control characters and overlong ones", () => {
  assert.deepEqual(validateTaskFilters({ status: "pending, blocked", other: "--x" }), { ok: true, value: { status: "pending, blocked" } });
  assert.equal(validateTaskFilters({ status: "--help" }).ok, false);
  assert.equal(validateTaskFilters({ label: "ui, -x" }).ok, false);
  assert.equal(validateTaskFilters({ text: "a\tb" }).ok, false);
  assert.equal(validateTaskFilters({ text: 3 }).ok, false);
  assert.equal(validateTaskFilters({ text: "a".repeat(FILTER_MAX_LENGTH) }).ok, true);
  assert.equal(validateTaskFilters({ text: "a".repeat(FILTER_MAX_LENGTH + 1) }).ok, false);
});

test("a row links to the task panel's address, keeping the filters; a selection is named", async () => {
  const envelope = await listed("/api/tasks?label=ui");
  const model = tasksModel(envelope, { label: "ui" }, {}, { task: "TASK-3" });
  const row = model.rows.find(r => r.id === "TASK-3");
  assert.equal(row.href, "?view=tasks&label=ui&task=TASK-3");
  assert.equal(row.selected, true);
  assert.equal(model.rows.filter(r => r.selected).length, 1);
  assert.deepEqual(model.selection, { id: "TASK-3", inList: true, text: TASKS_TEXT.selectionPending, closeHref: "?view=tasks&label=ui" });
  const missing = tasksModel(envelope, { label: "ui" }, {}, { task: "TASK-5" });
  assert.equal(missing.selection.inList, false);
  assert.equal(missing.rows.filter(r => r.selected).length, 0);
});

test("the model states: loading, ready, both empties, error and refusal; stale carried", () => {
  assert.deepEqual(tasksLoading(), { view: "tasks", state: "loading" });
  const env = { schemaVersion: 1, kind: "task-list", tasks: [], total: 0, limit: null };
  assert.equal(tasksModel(env).emptyKind, "no-active");
  assert.equal(tasksModel(env, { owner: "x" }).emptyKind, "no-match");
  assert.equal(tasksModel(env, {}, { stale: true, fetchedAt: "2026-11-02T10:00:00Z" }).freshness.stale, true);
  const refusal = tasksFailure({ error: { type: "refusal", message: "no", refusalKind: "locked" } }, 409);
  assert.equal(refusal.state, "refusal");
  assert.equal(refusal.refusalKind, "locked");
  assert.equal(tasksFailure({ error: { type: "contract-mismatch", message: "x" } }, 502).state, "error");
  assert.throws(() => tasksModel({ kind: "stats" }), TypeError);
  const limited = tasksModel({ ...env, tasks: [{ id: "TASK-1", title: "A" }], total: 4, limit: 1 });
  assert.equal(limited.count.text, "Showing 1 of 4 tasks");
});

test("no model string carries markup or an escape code", async () => {
  const envelope = await listed("/api/tasks");
  const stats = (await call(server, "/api/stats")).json;
  const models = [
    tasksModel(envelope, { label: "ui", text: "a" }, {}, { stats, task: "TASK-1" }),
    tasksModel({ ...envelope, tasks: [] }, { owner: "x" }),
    tasksModel({ ...envelope, tasks: [] }),
    tasksLoading(),
    tasksFailure({ error: { type: "refusal", message: "declined" } }, 409),
  ];
  for (const s of models.flatMap(m => strings(m))) {
    assert.doesNotMatch(s, /<[a-z/!]/i, `markup in ${JSON.stringify(s)}`);
    assert.doesNotMatch(s, /\x1b/, `escape code in ${JSON.stringify(s)}`);
  }
});
