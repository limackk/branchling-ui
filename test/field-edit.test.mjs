/**
 * The task panel's field edits (UI-6): `adapter.set()`, one `branchling set`,
 * and POST /api/task/field behind the write guard, served the way
 * bin/branchling-ui.mjs serves it (through UI-2's cache), against the REAL
 * branchling executable over test/fixtures/actions-backlog.mjs (every task
 * starts at P2; TASK-1 pending and nobody's). Requests go through node:http,
 * because fetch cannot set the Host header the guard judges.
 *
 * A test that writes builds its own fixture, so the order does not matter.
 */

import "./fixtures/private-homes.mjs";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAdapter, BranchlingRefusal, BranchlingUsageError, readTask } from "../src/adapter.mjs";
import { createServer, CAPABILITY_HEADER } from "../src/server.mjs";
import { createCache, servedFromCache } from "../src/cache.mjs";
import { taskPanelModel } from "../src/view-model/task.mjs";
import {
  EDITABLE_FIELDS, FIELD_EDIT_LIMITS, FIELD_EDIT_PATH,
  fieldCommand, fieldEditFailure, fieldEditRecorded, fieldEdits, validateFieldEdit,
} from "../src/view-model/task-fields.mjs";
import { BIN, buildActionsBacklog } from "./fixtures/actions-backlog.mjs";

const ACTOR = "local:maja";
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function fixture({ actor = ACTOR } = {}) {
  const root = mkdtempSync(join(tmpdir(), "branchling-ui-fields-"));
  roots.push(root);
  const fx = await buildActionsBacklog(join(root, "repo"), { bin: BIN });
  const env = { ...fx.env, BACKLOG_ACTOR: actor };
  return { ...fx, env, adapter: createAdapter({ bin: BIN, dir: fx.dir, cwd: fx.root, env }) };
}

/** The fixture's own task file and history, read by the TEST (never by product code). */
function taskFile(fx, id) {
  const name = readdirSync(join(fx.dir, "tasks")).find(f => f.startsWith(`${id}-`));
  return readFileSync(join(fx.dir, "tasks", name), "utf8");
}
function historyOf(fx, id) {
  return readFileSync(join(fx.dir, "history", `${id}.jsonl`), "utf8").trim().split("\n").map(line => JSON.parse(line));
}
const frontmatter = (text, key) => (text.match(new RegExp(`^${key}:\\s*(\\S+)`, "m")) || [])[1];

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

async function serve(fx, adapter = fx.adapter, changes) {
  const cached = servedFromCache(createCache(adapter, { dir: fx.dir, cwd: fx.root, changes }));
  const server = await createServer({ adapter: cached, port: 0, log: () => {} });
  const page = await call(server);
  const token = page.text.match(/name="branchling-ui-capability" content="([^"]+)"/)[1];
  const host = `127.0.0.1:${server.port}`;
  const post = (value, headers = {}) => call(server, {
    method: "POST",
    path: FIELD_EDIT_PATH,
    headers: { host, origin: `http://${host}`, [CAPABILITY_HEADER]: token, "content-type": "application/json", ...headers },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
  const panel = async id => {
    const res = await call(server, { path: `/api/task/panel?id=${id}` });
    assert.equal(res.status, 200, res.text);
    return res.json;
  };
  return { server, token, host, post, panel };
}

function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

// --- the acceptance criterion ----------------------------------------------------------

test("editing a fixture task's priority through the adapter changes the file and appends a history record with the given actor, and a status edit is refused", async () => {
  const fx = await fixture();
  const before = historyOf(fx, "TASK-1").length;
  assert.equal(frontmatter(taskFile(fx, "TASK-1"), "priority"), "P2");
  assert.equal((await fx.adapter.show("TASK-1")).priority, "P2");

  const set = await fx.adapter.set("TASK-1", "priority", "P1", { reason: "the audit depends on it", actor: "local:tester" });
  assert.equal(set.kind, "task-set");
  assert.equal(set.ok, true);
  assert.equal(set.id, "TASK-1");
  assert.equal(set.field, "priority");
  assert.equal(set.value, "P1");
  assert.equal(set.actor, "local:tester");

  // The file changed: the fixture's own file, and branchling's read of it.
  assert.equal(frontmatter(taskFile(fx, "TASK-1"), "priority"), "P1");
  assert.equal((await fx.adapter.show("TASK-1")).priority, "P1");

  // One history record, with the given actor and reason.
  const records = historyOf(fx, "TASK-1");
  assert.equal(records.length, before + 1);
  const last = records.at(-1);
  assert.equal(last.field, "priority");
  assert.equal(last.from, "P2");
  assert.equal(last.to, "P1");
  assert.equal(last.actor, "local:tester");
  assert.equal(last.reason, "the audit depends on it");
  assert.equal(last.source, "set");
  assert.deepEqual(set.changes.map(c => c.id), [last.id]);
  const log = await fx.adapter.log("TASK-1");
  assert.equal(log.exchanges.at(-1).actor, "local:tester");
  assert.deepEqual(log.exchanges.at(-1).changes.map(c => [c.field, c.from, c.to]), [["priority", "P2", "P1"]]);

  // A status edit is refused, and nothing is written.
  const status = await fx.adapter.set("TASK-1", "status", "done").then(() => null, err => err);
  assert.ok(status instanceof BranchlingRefusal, `expected a refusal, got ${status}`);
  assert.equal(status.envelope.kind, "task-set");
  assert.equal(status.envelope.refusalKind, "dedicated");
  assert.match(status.envelope.details.join(" "), /take/);
  assert.equal(frontmatter(taskFile(fx, "TASK-1"), "status"), "pending");
  assert.equal(historyOf(fx, "TASK-1").length, before + 1, "the refused edit appended nothing");
});

test("owner is refused like status, while another field of the same task is set (positive control)", async () => {
  const fx = await fixture();
  const owner = await fx.adapter.set("TASK-1", "owner", "local:maja").then(() => null, err => err);
  assert.ok(owner instanceof BranchlingRefusal);
  assert.equal(owner.envelope.refusalKind, "dedicated");
  assert.match(frontmatter(taskFile(fx, "TASK-1"), "owner"), /unassigned/);

  const epic = await fx.adapter.set("TASK-1", "epic", "Payments");
  assert.equal(epic.value, "Payments");
  assert.equal(epic.actor, ACTOR, "with no actor given, branchling resolves BACKLOG_ACTOR itself");
  assert.equal(historyOf(fx, "TASK-1").at(-1).reason, "unknown", "branchling's own word when no reason is given");
});

test("an unknown field, a value outside the vocabulary and an unknown task are branchling's refusals, each with its own text", async () => {
  const fx = await fixture();
  const unknown = await fx.adapter.set("TASK-1", "nonsense", "x").then(() => null, err => err);
  assert.ok(unknown instanceof BranchlingRefusal);
  assert.equal(unknown.envelope.refusalKind, "usage");
  assert.match(unknown.message, /not editable: nonsense/);

  const value = await fx.adapter.set("TASK-1", "priority", "PX").then(() => null, err => err);
  assert.ok(value instanceof BranchlingRefusal);
  assert.equal(value.envelope.refusalKind, "usage");
  assert.match(value.message, /PX.*P0, P1, P2, P3/, "branchling's refusal names the allowed values");

  const missing = await fx.adapter.set("TASK-99", "priority", "P1").then(() => null, err => err);
  assert.ok(missing instanceof BranchlingRefusal);
  assert.equal(missing.envelope.refusalKind, "not-found");

  // Positive control: the same field with an allowed value is set.
  assert.equal((await fx.adapter.set("TASK-1", "priority", "P0")).value, "P0");
});

test("EDITABLE_FIELDS is exactly the list the pinned branchling's set names as editable", async () => {
  const fx = await fixture();
  const err = await fx.adapter.set("TASK-1", "nonsense", "x").then(() => null, e => e);
  assert.ok(err instanceof BranchlingRefusal);
  // A test may read branchling's prose; product code does not.
  const line = err.envelope.details.find(d => d.startsWith("editable:"));
  assert.ok(line, `no editable: line in ${JSON.stringify(err.envelope.details)}`);
  const listed = line.slice("editable:".length).split(",").map(s => s.trim()).filter(Boolean);
  assert.deepEqual(EDITABLE_FIELDS.map(f => f.key), listed);
  assert.ok(!listed.includes("status") && !listed.includes("owner"));
});

test("a list field takes comma-separated items and an empty value clears it; an unchanged value records nothing", async () => {
  const fx = await fixture();
  const set = await fx.adapter.set("TASK-1", "labels", "billing, risk");
  assert.deepEqual(set.value, ["billing", "risk"]);
  assert.deepEqual(set.changes.map(c => [c.from, c.to]), [[[], ["billing", "risk"]]]);
  const again = await fx.adapter.set("TASK-1", "labels", "billing,risk");
  assert.deepEqual(again.changes, [], "the same value writes no history record");
  const cleared = await fx.adapter.set("TASK-1", "labels", "");
  assert.deepEqual(cleared.value, []);
  assert.deepEqual(cleared.changes.map(c => c.to), [[]]);
  // `log` reports a list change as branchling's comma-joined text; the history shows it.
  const model = taskPanelModel(await readTask(fx.adapter, "TASK-1"));
  const texts = model.history.entries.flatMap(e => e.changes.map(c => c.text));
  assert.ok(texts.includes("labels: (empty) → billing,risk"), texts.join(" | "));
  assert.ok(texts.includes("labels: billing,risk → (empty)"), texts.join(" | "));
});

test("the adapter refuses a value or a reason starting with '-' before anything is spawned", async () => {
  // A bin that does not exist: reaching the spawn would fail differently.
  const adapter = createAdapter({ bin: join(tmpdir(), "no-such-branchling-bin"), dir: tmpdir() });
  for (const [args, what] of [
    [["TASK-1", "title", "-leading dash"], "value"],
    [["TASK-1", "title", "--take-over"], "value"],
    [["TASK-1", "--actor", "x"], "field"],
    [["--help", "title", "x"], "id"],
    [["TASK-1", "title", "x", { reason: "--actor=agent:x" }], "reason"],
    [["TASK-1", "title", "x", { actor: "-x" }], "actor"],
    [["TASK-1", "title", undefined], "value"],
  ]) {
    const err = await adapter.set(...args).then(() => null, e => e);
    assert.ok(err instanceof BranchlingUsageError, `${what}: expected a usage error before spawn, got ${err}`);
  }
  // Positive control: a well-formed call does reach the spawn (and fails there).
  const spawned = await adapter.set("TASK-1", "title", "x").then(() => null, e => e);
  assert.ok(spawned && !(spawned instanceof BranchlingUsageError), "a valid call is not refused before the spawn");
});

// --- the route ---------------------------------------------------------------------------

test("POST /api/task/field sets a field through branchling, and the panel read after it is fresh", async () => {
  const fx = await fixture();
  const calls = { show: 0 };
  const counting = { ...fx.adapter, show: (...args) => { calls.show++; return fx.adapter.show(...args); } };
  const { server, post, panel } = await serve(fx, counting, { token: async () => "unchanged" });
  try {
    assert.equal(taskPanelModel(await panel("TASK-1")).priority, "P2");
    const spawned = calls.show;
    await panel("TASK-1");
    assert.equal(calls.show, spawned, "positive control: an unchanged backlog is answered from the cache");

    const res = await post({ id: "TASK-1", field: "priority", value: "P1", reason: "the audit depends on it" });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.kind, "task-set");
    assert.equal(res.json.actor, ACTOR, "no actor is passed: branchling resolved the server's BACKLOG_ACTOR");
    const after = taskPanelModel(await panel("TASK-1"));
    assert.ok(calls.show > spawned, "the write invalidated the cache");
    assert.equal(after.priority, "P1");
    assert.equal(historyOf(fx, "TASK-1").at(-1).reason, "the audit depends on it");

    const recorded = fieldEditRecorded(res.json);
    assert.equal(recorded.state, "recorded");
    assert.equal(recorded.actor, ACTOR);
    assert.deepEqual(recorded.changes.map(c => c.text), ["Priority: P2 → P1"]);
    assert.match(recorded.message, /Priority of TASK-1 is changed/);
    for (const s of strings(recorded)) assert.ok(!/[<\x1b]/.test(s), s);
  } finally {
    await server.close();
  }
});

test("POST /api/task/field refuses a body that names an actor, or any unknown key, with a 400 and nothing written", async () => {
  const fx = await fixture();
  const { server, post } = await serve(fx);
  try {
    const before = historyOf(fx, "TASK-1").length;
    for (const body of [
      { id: "TASK-1", field: "priority", value: "P0", actor: "local:mallory" },
      { id: "TASK-1", field: "priority", value: "P0", status: "done" },
      { id: "TASK-1", field: "priority" },
      { id: "--help", field: "priority", value: "P0" },
      { id: "TASK-1", field: "--actor", value: "P0" },
      { id: "TASK-1", field: "priority", value: "-P0" },
      [1, 2],
    ]) {
      const res = await post(body);
      assert.equal(res.status, 400, `${JSON.stringify(body)}: ${res.text}`);
      assert.equal(res.json.error.type, "bad-request");
    }
    const actor = await post({ id: "TASK-1", field: "priority", value: "P0", actor: "local:mallory" });
    assert.match(actor.json.error.message, /actor/);
    assert.equal(historyOf(fx, "TASK-1").length, before);
    assert.equal(frontmatter(taskFile(fx, "TASK-1"), "priority"), "P2");
    // Positive control: the same body without the actor is accepted.
    const ok = await post({ id: "TASK-1", field: "priority", value: "P0" });
    assert.equal(ok.status, 200, ok.text);
  } finally {
    await server.close();
  }
});

test("POST /api/task/field behind the host and write guard: no token, a foreign origin or a foreign host is a 403", async () => {
  const fx = await fixture();
  const { server, post, host } = await serve(fx);
  try {
    const body = { id: "TASK-1", field: "priority", value: "P0" };
    assert.equal((await post(body, { [CAPABILITY_HEADER]: "" })).status, 403);
    assert.equal((await post(body, { [CAPABILITY_HEADER]: "0".repeat(64) })).status, 403);
    assert.equal((await post(body, { origin: "http://evil.example" })).status, 403);
    assert.equal((await post(body, { host: `evil.example:${server.port}`, origin: `http://evil.example:${server.port}` })).status, 403);
    assert.equal(frontmatter(taskFile(fx, "TASK-1"), "priority"), "P2");
    assert.equal((await post(body, { host, origin: `http://${host}` })).status, 200, "positive control");
  } finally {
    await server.close();
  }
});

test("a refused edit is the server's 409 with branchling's text unchanged, which the model shows as a refusal", async () => {
  const fx = await fixture();
  const { server, post } = await serve(fx);
  try {
    const status = await post({ id: "TASK-1", field: "status", value: "done" });
    assert.equal(status.status, 409, status.text);
    assert.equal(status.json.error.refusalKind, "dedicated");
    const statusModel = fieldEditFailure(status.json, status.status);
    assert.equal(statusModel.state, "refusal");
    assert.equal(statusModel.detail, status.json.error.envelope.refusal);
    assert.deepEqual(statusModel.details, status.json.error.envelope.details);

    const value = await post({ id: "TASK-1", field: "priority", value: "PX" });
    assert.equal(value.status, 409, value.text);
    const valueModel = fieldEditFailure(value.json, value.status);
    assert.equal(valueModel.state, "refusal");
    assert.match(valueModel.detail, /allowed: P0, P1, P2, P3/);
    assert.match(valueModel.nothingWritten, /Nothing was written/);
    for (const s of strings(valueModel)) assert.ok(!/[<\x1b]/.test(s), s);
  } finally {
    await server.close();
  }
});

// --- the view model --------------------------------------------------------------------

test("validateFieldEdit accepts { id, field, value, reason? }, trimmed, an empty value included, and never an actor", () => {
  assert.deepEqual(validateFieldEdit({ id: "TASK-1", field: "priority", value: " P1 ", reason: " why " }), { ok: true, value: { id: "TASK-1", field: "priority", value: "P1", reason: "why" } });
  assert.deepEqual(validateFieldEdit({ id: "TASK-1", field: "epic", value: "" }), { ok: true, value: { id: "TASK-1", field: "epic", value: "" } });
  assert.deepEqual(validateFieldEdit({ id: "TASK-1", field: "epic", value: "x", reason: "  " }), { ok: true, value: { id: "TASK-1", field: "epic", value: "x" } });
  const refused = [
    [{ id: "TASK-1", field: "priority", value: "P1", actor: "local:x" }, null, /actor/],
    [{ id: "TASK-1", field: "priority", value: "P1", extra: 1 }, null, /Unknown field "extra"/],
    [{ id: "nope", field: "priority", value: "P1" }, "id", /not a task id/],
    [{ id: "TASK-1", field: "Priority", value: "P1" }, "field", /not a field name/],
    [{ id: "TASK-1", field: "priority", value: 1 }, "value", /text/],
    [{ id: "TASK-1", field: "title", value: " -x" }, "value", /"-"/],
    [{ id: "TASK-1", field: "title", value: "a\u0007" }, "value", /control/],
    [{ id: "TASK-1", field: "title", value: "x".repeat(FIELD_EDIT_LIMITS.value + 1) }, "value", /longer/],
    [{ id: "TASK-1", field: "title", value: "x", reason: "--actor" }, "reason", /"-"/],
    [null, null, /JSON object/],
  ];
  for (const [input, field, message] of refused) {
    const result = validateFieldEdit(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.field, field, JSON.stringify(input));
    assert.match(result.message, message);
  }
});

test("fieldCommand names the set command and never an --actor", () => {
  assert.equal(fieldCommand("TASK-1", "priority", "P1").text, "branchling set TASK-1 priority P1");
  assert.equal(fieldCommand("TASK-1", "labels", "a, b", "why not").text, 'branchling set TASK-1 labels "a, b" --reason "why not"');
  assert.equal(fieldCommand("TASK-1", "epic", "").text, 'branchling set TASK-1 epic ""');
  assert.ok(!fieldCommand("TASK-1", "epic", "x", "y").text.includes("--actor"));
});

test("fieldEdits offers every field set edits, never status or owner, with the current values the reads give", async () => {
  const fx = await fixture();
  await fx.adapter.set("TASK-1", "labels", "billing, risk");
  const edits = fieldEdits(await readTask(fx.adapter, "TASK-1"));
  assert.deepEqual(edits.map(e => e.key), EDITABLE_FIELDS.map(f => f.key));
  assert.ok(!edits.some(e => e.key === "status" || e.key === "owner"));
  const of = key => edits.find(e => e.key === key);
  assert.equal(of("priority").current, "P2");
  assert.equal(of("title").current, "Receipts are emailed after payment");
  assert.deepEqual([of("labels").list, of("labels").current], [true, "billing, risk"]);
  assert.equal(of("epic").known, true);
  assert.equal(of("epic").display, "(empty)");
  // No read of 0.3.0 carries these two; the model says so instead of showing them empty.
  assert.equal(of("confidence").known, false);
  assert.equal(of("blocks").known, false);
  for (const s of strings(edits)) assert.ok(!/[<\x1b]/.test(s), s);
});

test("fieldEditRecorded says when branchling recorded nothing because the value already was that", () => {
  const model = fieldEditRecorded({ kind: "task-set", ok: true, id: "TASK-1", field: "estimate", value: "2h", actor: "local:maja", changes: [] });
  assert.equal(model.changes.length, 0);
  assert.match(model.message, /already was 2h; branchling recorded nothing/);
  const none = fieldEditRecorded({ kind: "task-set", ok: true, id: "TASK-1", field: "epic", value: "x", changes: [{ field: "epic", from: "", to: "x" }] });
  assert.equal(none.actorKnown, false);
  assert.deepEqual(none.changes.map(c => c.text), ["Epic: (empty) → x"]);
});
