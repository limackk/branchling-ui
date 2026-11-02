/**
 * The shared view model, tested without a server. The envelopes are built
 * here by hand in the shape `branchling stats --json` prints (the server
 * contract test proves the real executable prints that shape).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import { STATS_TEXT, statsModel } from "../src/view-model/stats.mjs";
import { fromAdapterError, fromApiError, loadingState, unreachableState } from "../src/view-model/states.mjs";
import { BranchlingRefusal, BranchlingUsageError, ContractMismatch } from "../src/adapter.mjs";
import { priorityRole, statusRole } from "../src/view-model/roles.mjs";

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

test("the stats sentences are plain text shared by both surfaces", () => {
  assert.ok(isPlainData(STATS_TEXT));
  for (const s of strings(STATS_TEXT)) {
    assert.ok(s.length > 0);
    assert.doesNotMatch(s, /<[a-z/!]/i);
    assert.doesNotMatch(s, /\x1b/);
  }
});
