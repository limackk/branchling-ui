/**
 * The shared view model, tested without a server. The envelopes are built
 * here by hand in the shape `branchling stats --json` prints (the server
 * contract test proves the real executable prints that shape).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import { STATS_TEXT, statsModel } from "../src/view-model/stats.mjs";
import { fromAdapterError, fromApiError, loadingState, rejectedInputState, unreachableState } from "../src/view-model/states.mjs";
import { BranchlingRefusal, BranchlingUsageError, ContractMismatch } from "../src/adapter.mjs";
import { priorityRole, statusRole } from "../src/view-model/roles.mjs";
import { DECISIONS_TEXT, answerCommands, shellWord } from "../src/view-model/decisions.mjs";
import { PLAN_TEXT, taskNotes } from "../src/view-model/plan.mjs";
import { RELEASE_TEXT, releaseModel } from "../src/view-model/release.mjs";

function envelope(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "stats",
    root: "/tmp/fixture/backlog",
    stats: {
      total: 3,
      active: 3,
      archived: 0,
      byStatus: { pending: 1, in_progress: 1, blocked: 0, done: 1, cancelled: 0 },
      byPriority: { P2: 1, P1: 2 },
      byBoard: { main: 3 },
      openHours: { hours: 4, unknown: 1 },
      blocked: 0,
      divergent: 0,
      ...overrides,
    },
  };
}

/** Every string anywhere in `value`. */
function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

/** True when `value` is JSON-shaped data: no functions, classes or DOM nodes. */
function isPlainData(value) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isPlainData);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return Object.values(value).every(isPlainData);
  return false;
}

test("the stats model is plain data built from a stats envelope", () => {
  const model = statsModel(envelope());
  assert.ok(isPlainData(model));
  assert.deepEqual(JSON.parse(JSON.stringify(model)), model);
  assert.equal(model.view, "stats");
  assert.equal(model.state, "ready");
  assert.equal(model.root, "/tmp/fixture/backlog");
  assert.deepEqual(model.totals.find(t => t.key === "total"), { key: "total", label: "Tasks", value: 3 });
  assert.deepEqual(model.totals.map(t => t.key), ["total", "active", "blocked", "archived"]);
  assert.deepEqual(model.byStatus.find(r => r.key === "in_progress"), { key: "in_progress", label: "in progress", count: 1, role: "neutral" });
  assert.deepEqual(model.byPriority.map(r => r.key), ["P1", "P2"]);
  assert.deepEqual(model.openHours, { hours: 4, unknown: 1 });
  assert.deepEqual(model.freshness, { stale: false, fetchedAt: null });
});

test("no string in the model carries markup or terminal escape codes", () => {
  // The model adds no formatting of its own. Keys from a backlog are passed
  // on as text, and each surface inserts them as text (textContent on the
  // web), never as markup.
  const model = statsModel(envelope());
  const all = strings(model);
  assert.ok(all.length > 5, "positive control: the model has strings to check");
  for (const s of all) {
    assert.doesNotMatch(s, /<[a-z/!]/i, `markup in ${JSON.stringify(s)}`);
    assert.doesNotMatch(s, /\x1b/, `escape code in ${JSON.stringify(s)}`);
  }
});

test("the view model modules import nothing a browser cannot load", () => {
  const dir = new URL("../src/view-model/", import.meta.url);
  const files = readdirSync(dir).filter(f => f.endsWith(".mjs"));
  assert.ok(files.includes("stats.mjs"));
  assert.ok(files.includes("plan.mjs"));
  assert.ok(files.includes("health.mjs"));
  for (const file of files) {
    const source = readFileSync(new URL(file, dir), "utf8");
    for (const [, spec] of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      assert.match(spec, /^\.\/[a-z-]+\.mjs$/, `${file} imports ${spec}`);
    }
    assert.doesNotMatch(source, /\b(process|require|document|window)\b\s*[.(]/, `${file} touches a runtime`);
  }
});

test("no total is derived from status names; every total comes from the envelope", () => {
  const base = envelope({ total: 18, active: 13, archived: 5, blocked: 2 });
  const values = model => Object.fromEntries(model.totals.map(t => [t.key, t.value]));
  assert.deepEqual(values(statsModel(base)), { total: 18, active: 13, blocked: 2, archived: 5 });
  // A custom vocabulary: the counts by status change completely, the totals
  // branchling computed do not.
  const custom = envelope({
    total: 18, active: 13, archived: 5, blocked: 2,
    byStatus: { shipped: 9, cancelled: 0, done: 0, pending: 0, idea: 9 },
  });
  assert.deepEqual(values(statsModel(custom)), values(statsModel(base)));
  // Positive control: the totals do follow the envelope.
  assert.equal(values(statsModel(envelope({ active: 7 }))).active, 7);
});

test("an empty backlog is the empty state, not an error", () => {
  const model = statsModel(envelope({ total: 0, active: 0, byStatus: { pending: 0, done: 0 }, byPriority: {} }));
  assert.equal(model.state, "empty");
  assert.deepEqual(model.byPriority, []);
  // Positive control: the same builder answers "ready" when there are tasks.
  assert.equal(statsModel(envelope()).state, "ready");
});

test("freshness from the cache is carried into the model as stale", () => {
  const model = statsModel(envelope(), { stale: true, fetchedAt: "2026-11-02T10:00:00Z" });
  assert.deepEqual(model.freshness, { stale: true, fetchedAt: "2026-11-02T10:00:00Z" });
});

test("anything but a stats envelope is rejected instead of rendered as zeros", () => {
  assert.throws(() => statsModel({ schemaVersion: 1, kind: "plan" }), TypeError);
  assert.throws(() => statsModel(null), TypeError);
});

test("every status and priority has the neutral role until UI-18", () => {
  for (const key of ["pending", "done", "blocked", "anything-custom"]) assert.equal(statusRole(key), "neutral");
  for (const key of ["P0", "P3", "high"]) assert.equal(priorityRole(key), "neutral");
});

test("a refusal body becomes the refusal state, other failures the error state", () => {
  const refusal = fromApiError("stats", { error: { type: "refusal", refusalKind: "held", message: "Held by someone else" } }, 409);
  assert.equal(refusal.state, "refusal");
  assert.equal(refusal.refusalKind, "held");
  assert.equal(refusal.detail, "Held by someone else");

  const mismatch = fromApiError("stats", { error: { type: "contract-mismatch", message: "schemaVersion 99" } }, 502);
  assert.equal(mismatch.state, "error");
  assert.equal(mismatch.errorType, "contract-mismatch");
  assert.equal(mismatch.httpStatus, 502);

  const unknown = fromApiError("stats", null);
  assert.equal(unknown.state, "error");
  assert.equal(unknown.errorType, "unknown");

  assert.deepEqual(loadingState("stats"), { view: "stats", state: "loading" });
  assert.equal(unreachableState("stats", "ECONNREFUSED").errorType, "unreachable");
  for (const model of [refusal, mismatch, unknown]) assert.ok(isPlainData(model));
});

test("an adapter error becomes the same state the API error would", () => {
  // The terminal calls the adapter directly; the web page gets the server's
  // JSON body. Both must land on the same state and title.
  const envelope = { schemaVersion: 1, kind: "stats", refusalKind: "held", refusal: "Held by someone else" };
  const refusal = fromAdapterError("stats", new BranchlingRefusal(envelope, 1));
  assert.equal(refusal.state, "refusal");
  assert.equal(refusal.refusalKind, "held");
  assert.equal(refusal.detail, "Held by someone else");
  assert.equal(refusal.title, fromApiError("stats", { error: { type: "refusal", message: "x" } }).title);

  const mismatch = fromAdapterError("stats", new ContractMismatch("schemaVersion 99"));
  assert.equal(mismatch.state, "error");
  assert.equal(mismatch.errorType, "contract-mismatch");
  assert.equal(mismatch.title, fromApiError("stats", { error: { type: "contract-mismatch" } }).title);

  const usage = fromAdapterError("stats", new BranchlingUsageError(["stats"], 2, "no backlog"));
  assert.equal(usage.errorType, "usage-error");

  const other = fromAdapterError("stats", new Error("spawn branchling ENOENT"));
  assert.equal(other.state, "error");
  assert.equal(other.errorType, "internal");
  assert.equal(other.detail, "spawn branchling ENOENT");
  for (const model of [refusal, mismatch, usage, other]) assert.ok(isPlainData(model));
});

// --- UI-21: a name the user typed that branchling rejected ------------------
// The bodies are the server's `422 rejected-input` shape; test/release-view
// proves the real executable and route produce it.

const STDERR_RELEASE = "\u2717 branchling deploy status: `nope` is not a declared release (declared: 1.0, 1.1)";

test("a rejected typed name is its own state, not the interface-bug error", () => {
  const body = { error: { type: "rejected-input", message: "branchling rejected a name that was typed: release=nope", input: { release: "nope" }, declared: { release: null }, detail: STDERR_RELEASE } };
  const model = fromApiError("release", body, 422);
  assert.equal(model.state, "rejected");
  assert.equal(model.errorType, "rejected-input");
  assert.equal(model.httpStatus, 422);
  assert.equal(model.title, "No release named \u201cnope\u201d is declared");
  assert.notEqual(model.title, fromApiError("release", { error: { type: "usage-error", message: "x" } }, 500).title);
  assert.deepEqual(model.names.map(n => [n.key, n.value, n.known]), [["release", "nope", false]]);
  // branchling gives no list of releases as data: said so, never an empty list.
  assert.equal(model.names[0].declared, null);
  assert.match(model.names[0].declaredText, /no list of the declared releases/);
  assert.equal(model.branchlingSaid, STDERR_RELEASE);
  assert.ok(isPlainData(model));

  // Negative control: a usage error with no typed name is still this package's bug.
  const bug = fromApiError("release", { error: { type: "usage-error", message: "unknown flag --nope" } }, 500);
  assert.equal(bug.state, "error");
  assert.equal(bug.title, "The interface called branchling incorrectly");
});

test("a rejected typed name lists the declared names branchling gave as data", () => {
  const model = fromApiError("release", { error: { type: "rejected-input", input: { target: "nope" }, declared: { target: ["api", "web"] }, detail: "x" } }, 422);
  assert.equal(model.title, "No deploy target named \u201cnope\u201d is declared");
  assert.deepEqual(model.names[0].declared, ["api", "web"]);
  assert.equal(model.names[0].declaredText, "The declared deploy targets: api, web.");
  assert.equal(model.names[0].isDeclared, false);

  // A declared list that is empty is said as such, distinct from unknown.
  const none = rejectedInputState("release", { input: { target: "web" }, declared: { target: [] } });
  assert.equal(none.names[0].declaredText, "This backlog declares no deploy targets.");

  // Two typed names, one of them declared: the other is the one named.
  const two = rejectedInputState("release", { input: { release: "nope", target: "web" }, declared: { release: null, target: ["web"] } }, 422);
  assert.equal(two.title, "No release named \u201cnope\u201d is declared");
  assert.deepEqual(two.names.map(n => n.key), ["release"]);
  // Neither known to be declared: both named, one title for both.
  const both = rejectedInputState("release", { input: { release: "nope", target: "gone" }, declared: { release: null, target: ["web"] } });
  assert.equal(both.title, "A name that was typed is not declared");
  assert.deepEqual(both.names.map(n => n.key), ["release", "target"]);
  for (const m of [model, none, two, both]) {
    assert.ok(isPlainData(m));
    for (const str of strings(m)) {
      assert.doesNotMatch(str, /<[a-z/!]/i);
      assert.doesNotMatch(str, /\x1b/);
    }
  }
});

test("the stats sentences are plain text shared by both surfaces", () => {
  assert.ok(isPlainData(STATS_TEXT));
  for (const s of strings(STATS_TEXT)) {
    assert.ok(s.length > 0);
    assert.doesNotMatch(s, /<[a-z/!]/i);
    assert.doesNotMatch(s, /\x1b/);
  }
});

test("the web page takes its stats sentences from STATS_TEXT, not its own copies", () => {
  const app = readFileSync(new URL("../src/web/app.mjs", import.meta.url), "utf8");
  // Positive controls: this is the page module, and it imports the shared text.
  assert.match(app, /function renderStats\(/);
  assert.match(app, /import \{[^}]*\bSTATS_TEXT\b[^}]*\} from "\/view-model\/stats\.mjs"/);
  for (const key of ["loading", "empty", "stale", "byStatus", "byPriority", "countHeading"]) {
    assert.ok(app.includes(`STATS_TEXT.${key}`), `app.mjs renders STATS_TEXT.${key}`);
  }
  // No sentence may appear as a string literal of its own. Quoted, so the
  // caption "Tasks by status" does not count as a copy of "Tasks".
  for (const [key, sentence] of Object.entries(STATS_TEXT)) {
    for (const q of ['"', "'", "`"]) {
      assert.ok(!app.includes(`${q}${sentence}${q}`), `app.mjs carries its own copy of STATS_TEXT.${key}`);
    }
  }
});

test("the static page's pre-script placeholders match STATS_TEXT", () => {
  // index.html cannot import the module; app.mjs replaces the placeholder on
  // load, but what shows before the script runs must not drift either.
  const html = readFileSync(new URL("../src/web/index.html", import.meta.url), "utf8");
  assert.match(html, /<h2 id="stats-title">([^<]*)<\/h2>/);
  assert.equal(html.match(/<h2 id="stats-title">([^<]*)<\/h2>/)[1], STATS_TEXT.title);
  assert.equal(html.match(/<div id="stats"[^>]*>\s*<p class="state state-loading">([^<]*)<\/p>/)[1], STATS_TEXT.loading);
});

// --- what the terminal screens need from the models (UI-31) -----------------


test("answerCommands gives the exact branchling decide commands, quoted for a shell, never with --actor", () => {
  const plain = answerCommands("TASK-1", "01M6EZ150NDP3Y6QZPJY4PZW6R");
  assert.equal(plain.reason, `branchling decide TASK-1 --resolves 01M6EZ150NDP3Y6QZPJY4PZW6R --reason "${DECISIONS_TEXT.reasonPlaceholder}"`);
  assert.equal(plain.choose, null, "no options known, no --choose");
  const menu = answerCommands("TASK-1", "Q1", { optionsKnown: true, options: [{ number: 1 }] });
  assert.equal(menu.choose, "branchling decide TASK-1 --resolves Q1 --choose N");
  assert.equal(answerCommands("TASK-1", "Q1", { optionsKnown: true, options: [] }).choose, null, "positive control: an empty menu offers no --choose");
  for (const c of [plain.reason, menu.choose, menu.reason]) assert.doesNotMatch(c, /--actor/);
  // Data from a backlog cannot break out of its word.
  assert.equal(shellWord("TASK-1"), "TASK-1");
  assert.equal(shellWord("a b"), "'a b'");
  assert.equal(shellWord("it's;rm"), "'it'\\''s;rm'");
  assert.equal(shellWord("-x"), "'-x'");
  assert.equal(answerCommands("T 1", "$(x)").reason.startsWith("branchling decide 'T 1' --resolves '$(x)' --reason"), true);
});

test("plan task notes say what the web page says, in its order", () => {
  assert.deepEqual(taskNotes({ inFlight: true, overtaken: true, known: false, waitsOn: [{ id: "A-1", open: true }, { id: "A-2", open: false }, { id: "A-3", open: null }], unblocks: ["A-4", "A-5"] }),
    ["in flight", "overtaken", "not in this backlog", "waits on A-1", "after A-2 (closed)", "after A-3", "unblocks A-4, A-5"]);
  assert.deepEqual(taskNotes({ inFlight: false, overtaken: false, known: true, waitsOn: [], unblocks: [] }), []);
  for (const s of strings(PLAN_TEXT)) assert.doesNotMatch(s, /<[a-z/!]|\x1b/i);
  for (const s of strings(RELEASE_TEXT)) assert.doesNotMatch(s, /<[a-z/!]|\x1b/i);
  for (const s of strings(DECISIONS_TEXT)) assert.doesNotMatch(s, /<[a-z/!]|\x1b/i);
});

test("release rows carry the notes the web page lists beside them, and a release its counts sentence", () => {
  const model = releaseModel({
    schemaVersion: 1,
    kind: "release-status",
    trunk: { spec: "HEAD", sha: "a".repeat(40), source: "head" },
    scan: { refs: [] },
    targets: [{ target: "web", buckets: [
      { kind: "waiting", stage: "staging", label: "on the trunk, waiting for staging", count: 1, tasks: [{ id: "T-1", title: "One", status: "done", closed: "2026-11-01", waitedDays: 2 }] },
      { kind: "waiting", stage: "production", label: "in staging, waiting for production", count: 1, unknown: true, unknownRefs: ["refs/x"], tasks: [{ id: "T-2", title: "Two", status: null }] },
    ] }],
    release: { name: "1.1", planned: 3, shipped: { count: 1 }, dropped: { count: 0 }, current: "1.1",
      notShipped: { count: 1, tasks: [{ id: "T-3", title: "Three", status: "pending", priority: "P1", standing: [] }] }, open: { count: 0, tasks: [] }, unplanned: { count: 0, tasks: [] } },
  });
  const [waiting, unknown] = model.lanes[0].columns;
  assert.deepEqual(waiting.tasks[0].notes, ["done 2026-11-01", "waiting 2d"]);
  assert.deepEqual(unknown.tasks[0].notes, ["no task file", "waiting time unknown", "unknown"]);
  assert.equal(model.release.countsText, "3 planned · 1 shipped (counted, not listed) · 0 dropped");
  assert.deepEqual(model.release.sections[0].tasks[0].notes, ["pending", "P1"]);
});

/** A web page module's source, for the "no copies of its own" checks. */
function webSource(name) {
  return readFileSync(new URL(`../src/web/${name}`, import.meta.url), "utf8");
}

/** Every string of `text` that appears in `source` as a quoted literal of its own. */
function ownCopies(source, text) {
  const found = [];
  for (const [key, sentence] of Object.entries(text)) {
    for (const q of ['"', "'", "`"]) if (source.includes(`${q}${sentence}${q}`)) found.push(key);
  }
  return found;
}

test("the web plan page takes its sentences from PLAN_TEXT, not its own copies", () => {
  const page = webSource("plan.mjs");
  // Positive controls: this is the page module, it imports the shared text,
  // and the check would catch a copy (the sentence is quoted in the model).
  assert.match(page, /function renderPlan\(/);
  assert.match(page, /import \{[^}]*\bPLAN_TEXT\b[^}]*\} from "\/view-model\/plan\.mjs"/);
  assert.deepEqual(ownCopies(readFileSync(new URL("../src/view-model/plan.mjs", import.meta.url), "utf8"), { footnote: PLAN_TEXT.footnote }), ["footnote"]);
  // The title is the static page's heading, pinned to PLAN_TEXT below.
  for (const key of Object.keys(PLAN_TEXT).filter(k => k !== "title")) {
    assert.ok(page.includes(`PLAN_TEXT.${key}`), `plan.mjs renders PLAN_TEXT.${key}`);
  }
  assert.deepEqual(ownCopies(page, PLAN_TEXT), [], "plan.mjs carries its own copy of these PLAN_TEXT keys");
  // The fixed parts of the model's task notes (taskNotes): the page lists task.notes.
  for (const fixed of ['"in flight"', '"overtaken"', '"not in this backlog"', "`waits on ${", "`after ${", "`unblocks ${", "`Wave ${", "`Done as one"]) {
    assert.ok(!page.includes(fixed), `plan.mjs carries its own ${fixed}`);
  }
});

test("the web release page takes its sentences from RELEASE_TEXT, not its own copies", () => {
  const page = webSource("release.mjs");
  assert.match(page, /function renderRelease\(/);
  assert.match(page, /import \{[^}]*\bRELEASE_TEXT\b[^}]*\} from "\/view-model\/release\.mjs"/);
  for (const key of Object.keys(RELEASE_TEXT).filter(k => k !== "title")) {
    assert.ok(page.includes(`RELEASE_TEXT.${key}`), `release.mjs renders RELEASE_TEXT.${key}`);
  }
  assert.deepEqual(ownCopies(page, RELEASE_TEXT), [], "release.mjs carries its own copy of these RELEASE_TEXT keys");
  // The row notes and the counts sentence are the model's (notes, countsText).
  for (const fixed of ["`Release ${", " planned · ", "shipped (", '"unknown"']) {
    assert.ok(!page.includes(fixed), `release.mjs carries its own ${fixed}`);
  }
});

test("the static page's plan and release placeholders match PLAN_TEXT and RELEASE_TEXT", () => {
  const html = webSource("index.html");
  assert.equal(html.match(/<h2 id="plan-title">([^<]*)<\/h2>/)[1], PLAN_TEXT.title);
  assert.equal(html.match(/<div id="plan"[^>]*>\s*<p class="state state-loading">([^<]*)<\/p>/)[1], PLAN_TEXT.loading);
  assert.equal(html.match(/<h2 id="release-title">([^<]*)<\/h2>/)[1], RELEASE_TEXT.title);
  assert.equal(html.match(/<div id="release"[^>]*>\s*<p class="state state-loading">([^<]*)<\/p>/)[1], RELEASE_TEXT.loading);
});

test("PLAN_TEXT shows a command's placeholders as bare upper-case words on both surfaces", () => {
  assert.ok(PLAN_TEXT.emptyHint.includes('`branchling plan add ID --wave "NAME"`'));
  for (const name of ["plan.mjs", "release.mjs"]) assert.doesNotMatch(webSource(name), /plan add <|--wave \\?"</);
});
