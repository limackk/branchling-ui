/**
 * The task panel's field edits (UI-6): `adapter.set()`, one `branchling set`,
 * and POST /api/task/field behind the write guard, served the way
 * bin/branchling-ui.mjs serves it (through UI-2's cache), against the REAL
 * branchling executable over test/fixtures/actions-backlog.mjs (every task
 * starts at P2; TASK-1 pending and nobody's). Requests go through node:http,
 * because fetch cannot set the Host header the guard judges.
 *
 * Which fields are edited, and what their boxes start with, is branchling's
 * own data (UI-39): `set --fields --json` (TL-543) composed into the panel's
 * answer by readTask. The tests named "fields from branchling" are the
 * task's verification.
 *
 * A test that writes builds its own fixture, so the order does not matter.
 */

import "./fixtures/private-homes.mjs";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAdapter, BranchlingRefusal, BranchlingUsageError, ContractMismatch, readTask } from "../src/adapter.mjs";
import { createServer, CAPABILITY_HEADER } from "../src/server.mjs";
import { createCache, servedFromCache } from "../src/cache.mjs";
import { taskPanelModel } from "../src/view-model/task.mjs";
import {
  FIELD_EDIT_LIMITS, FIELD_EDIT_PATH, FIELD_EDIT_TEXT, FIELD_LABELS,
  choiceValue, declaredValues, fieldCommand, fieldEditFailure, fieldEditRecorded, fieldEdits, fieldEditsNote, fieldLabel, validateFieldEdit,
} from "../src/view-model/task-fields.mjs";
import { TASK_ACTIONS_TEXT } from "../src/view-model/task-actions.mjs";
import { BIN, ROLES, buildActionsBacklog } from "./fixtures/actions-backlog.mjs";
import { PRIORITIES, buildVocabularyBacklog } from "./fixtures/vocabulary-backlog.mjs";

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
  assert.equal(value.envelope.refusalKind, "unknown-value", "TL-543: not `usage` any more");
  assert.equal(value.code, 1);
  assert.deepEqual(value.envelope.rejected, { field: "priority", value: "PX" });
  assert.deepEqual(value.envelope.declared, ["P0", "P1", "P2", "P3"]);
  assert.match(value.message, /PX.*P0, P1, P2, P3/, "branchling's refusal names the allowed values");

  const missing = await fx.adapter.set("TASK-99", "priority", "P1").then(() => null, err => err);
  assert.ok(missing instanceof BranchlingRefusal);
  assert.equal(missing.envelope.refusalKind, "not-found");

  // Positive control: the same field with an allowed value is set.
  assert.equal((await fx.adapter.set("TASK-1", "priority", "P0")).value, "P0");
});

test("the fields from branchling: set --fields lists what set edits, as data, and agrees with the usage refusal's prose", async () => {
  const fx = await fixture();
  const described = await fx.adapter.setFields();
  assert.equal(described.kind, "task-set-fields");
  const names = described.fields.map(f => f.name);
  assert.ok(names.length > 0, "positive control: a non-empty list, so the checks below have something to judge");
  assert.ok(!names.includes("status") && !names.includes("owner"), "take, done, handoff, release and ask own them");
  for (const f of described.fields) {
    assert.deepEqual(Object.keys(f).sort(), ["clearable", "list", "name", "suggestions", "values", "vocabulary"], f.name);
  }
  const of = name => described.fields.find(f => f.name === name);
  assert.equal(of("labels").list, true);
  assert.equal(of("priority").vocabulary, "priorities");
  assert.equal(of("priority").clearable, false);
  assert.deepEqual(of("executor").values, ["human", "agent"]);
  // The same list branchling names in prose; a TEST may read prose, product code does not.
  const err = await fx.adapter.set("TASK-1", "nonsense", "x").then(() => null, e => e);
  assert.ok(err instanceof BranchlingRefusal);
  const line = err.envelope.details.find(d => d.startsWith("editable:"));
  assert.ok(line, `no editable: line in ${JSON.stringify(err.envelope.details)}`);
  assert.deepEqual(names, line.slice("editable:".length).split(",").map(s => s.trim()).filter(Boolean));
  // No list of names is kept in the view model any more: only labels, which decide no membership.
  const model = readFileSync(new URL("../src/view-model/task-fields.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(model, /EDITABLE_FIELDS/);
});

/**
 * A build before TL-543 (branchling 0.3.0 as published): `set --fields` is a
 * `task-set` usage refusal naming the unknown flag; anything else is answered
 * with `answer`. Every spawn appends a line to `calls`, so the test counts them.
 */
function stubBin(root, name, answer) {
  const refusal = '{"schemaVersion":1,"kind":"task-set","ok":false,"refusalKind":"usage","refusal":"unknown flag: --fields","details":["available: --dir --actor --reason --json"]}';
  const calls = join(root, `${name}-calls`);
  const file = join(root, process.platform === "win32" ? `${name}.cmd` : name);
  if (process.platform === "win32") {
    writeFileSync(file, [
      "@echo off",
      `echo %*>>"${calls}"`,
      answer === null ? `for %%a in (%*) do if "%%~a"=="--fields" (echo ${refusal}& exit /b 2)` : "",
      `echo ${answer === null ? refusal : answer}`,
      answer === null ? "exit /b 2" : "",
      "",
    ].join("\r\n"));
  } else {
    writeFileSync(file, [
      "#!/bin/sh",
      `echo "$*" >> '${calls}'`,
      `echo '${answer === null ? refusal : answer}'`,
      answer === null ? "exit 2" : "",
      "",
    ].join("\n"));
  }
  chmodSync(file, 0o755);
  return { file, calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split(/\r?\n/) : []) };
}

test("the fields from branchling: a build without set --fields gives no pens and says why, asked once", async () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-ui-pre-fields-"));
  roots.push(root);
  const stub = stubBin(root, "pre-fields", null);
  const old = createAdapter({ bin: stub.file, dir: root });
  assert.equal(await old.setFields(), null);
  assert.equal(await old.setFields(), null);
  assert.equal(stub.calls().length, 1, "the refusal is remembered: no second spawn");
  const answer = { kind: "task-panel", composed: true, id: "TASK-1", show: { title: "t", priority: "P1" }, log: {}, task: null, blocks: [], fields: null };
  assert.deepEqual(fieldEdits(answer), [], "no list is guessed");
  assert.equal(fieldEditsNote(answer), FIELD_EDIT_TEXT.unavailable);
  // Positive control: an answer that carries fields has pens and no note.
  const described = { ...answer, fields: [{ name: "title", list: false, clearable: false, vocabulary: null, suggestions: null, values: null }] };
  assert.deepEqual(fieldEdits(described).map(e => e.key), ["title"]);
  assert.equal(fieldEditsNote(described), null);
  assert.throws(() => fieldEdits({ ...answer, fields: undefined }), TypeError, "an answer without the key is not read as an old build");
});

test("the fields from branchling: any other failure throws, and a field of another shape is a contract mismatch", async () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-ui-bad-fields-"));
  roots.push(root);
  // A bin that does not exist is not "an old build".
  await assert.rejects(createAdapter({ bin: join(root, "no-such-bin"), dir: root }).setFields(), err => !(err instanceof ContractMismatch) && err !== null);
  for (const fields of [
    [{ name: "title", list: "no", clearable: false, vocabulary: null, suggestions: null, values: null }],
    [{ name: "Title", list: false, clearable: false, vocabulary: null, suggestions: null, values: null }],
    [{ name: "executor", list: false, clearable: true, vocabulary: null, suggestions: null, values: "human" }],
    [{ list: false }],
    "title",
  ]) {
    const stub = stubBin(root, `bad-${Math.random().toString(36).slice(2)}`, JSON.stringify({ schemaVersion: 1, kind: "task-set-fields", root, fields }));
    await assert.rejects(createAdapter({ bin: stub.file, dir: root }).setFields(), ContractMismatch, JSON.stringify(fields));
  }
  // Positive control: the same stub with a well-formed field is accepted.
  const good = stubBin(root, "good", JSON.stringify({ schemaVersion: 1, kind: "task-set-fields", root, fields: [{ name: "title", list: false, clearable: false, vocabulary: null, suggestions: null, values: null }] }));
  assert.deepEqual((await createAdapter({ bin: good.file, dir: root }).setFields()).fields.map(f => f.name), ["title"]);
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

test("a value starting with '-' is set as written, after branchling's --, with no flag read out of it", async () => {
  const fx = await fixture();
  for (const value of ["-leading dash", "--take-over", "--actor=agent:x"]) {
    const set = await fx.adapter.set("TASK-1", "title", value);
    assert.equal(set.value, value);
    assert.equal(set.actor, ACTOR, `${value}: no actor was smuggled in`);
    assert.equal(taskPanelModel(await readTask(fx.adapter, "TASK-1")).title, value);
  }
});

test("the adapter refuses an id, a field, a reason or an actor starting with '-' before anything is spawned", async () => {
  // A bin that does not exist: reaching the spawn would fail differently.
  const adapter = createAdapter({ bin: join(tmpdir(), "no-such-branchling-bin"), dir: tmpdir() });
  for (const [args, what] of [
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
  const calls = { show: 0, setFields: 0 };
  const counting = {
    ...fx.adapter,
    show: (...args) => { calls.show++; return fx.adapter.show(...args); },
    setFields: () => { calls.setFields++; return fx.adapter.setFields(); },
  };
  const { server, post, panel } = await serve(fx, counting, { token: async () => "unchanged" });
  try {
    assert.equal(taskPanelModel(await panel("TASK-1")).priority, "P2");
    const spawned = calls.show;
    assert.equal(calls.setFields, 1, "the panel read asks set --fields");
    await panel("TASK-1");
    assert.equal(calls.show, spawned, "positive control: an unchanged backlog is answered from the cache");
    assert.equal(calls.setFields, 1, "set --fields is a cached read, not a write that empties the cache");

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
      { id: "TASK-1", field: "priority", value: "P0", reason: "--actor" },
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

    assert.equal(statusModel.fix, null, "a dedicated field names no box to fix");

    const value = await post({ id: "TASK-1", field: "priority", value: "PX" });
    assert.equal(value.status, 409, value.text);
    assert.equal(value.json.error.refusalKind, "unknown-value");
    const valueModel = fieldEditFailure(value.json, value.status);
    assert.equal(valueModel.state, "refusal");
    assert.match(valueModel.detail, /allowed: P0, P1, P2, P3/, "branchling's own text, unchanged");
    assert.match(valueModel.nothingWritten, /Nothing was written/);
    assert.deepEqual(valueModel.fix, {
      field: "value",
      message: 'Priority cannot be "PX" in this backlog. Use one of: P0, P1, P2, P3.',
      declared: ["P0", "P1", "P2", "P3"],
    });
    for (const s of strings(valueModel)) assert.ok(!/[<\x1b]/.test(s), s);

    // Positive control: the allowed value passes the same route.
    assert.equal((await post({ id: "TASK-1", field: "priority", value: "P0" })).status, 200);
  } finally {
    await server.close();
  }
});

test("a field edit with no stated actor is refused as actor-required and writes nothing; with an actor it is recorded under it", async () => {
  // No $BACKLOG_ACTOR and no user config (the fixture's homes are private).
  const fx = await fixture({ actor: null });
  const before = historyOf(fx, "TASK-1").length;
  let err;
  await assert.rejects(fx.adapter.set("TASK-1", "priority", "P1"), e => { err = e; return e instanceof BranchlingRefusal; });
  assert.equal(err.envelope.kind, "task-set");
  assert.equal(err.envelope.refusalKind, "actor-required");
  assert.equal(err.envelope.actorSource, "default");
  assert.equal(err.code, 1);

  const { server, post } = await serve(fx);
  try {
    const res = await post({ id: "TASK-1", field: "priority", value: "P1", reason: "the audit" });
    assert.equal(res.status, 409, res.text);
    assert.equal(res.json.error.refusalKind, "actor-required");
    const shown = fieldEditFailure(res.json, res.status);
    assert.equal(shown.state, "refusal");
    assert.equal(shown.actorRequired, true);
    assert.equal(shown.title, TASK_ACTIONS_TEXT.actorRequiredTitle);
    assert.equal(shown.hint, TASK_ACTIONS_TEXT.actorRequiredHint);
    assert.equal(shown.fix, null, "no box of the form is to blame");
  } finally {
    await server.close();
  }
  assert.equal(frontmatter(taskFile(fx, "TASK-1"), "priority"), "P2", "the file is unchanged");
  assert.equal(historyOf(fx, "TASK-1").length, before, "no history record was appended");

  // Positive controls: a stated actor, by flag or by environment, is recorded under it.
  const flagged = await fx.adapter.set("TASK-1", "priority", "P1", { actor: "local:tester" });
  assert.equal(flagged.actor, "local:tester");
  assert.equal(flagged.actorSource, "flag");
  assert.equal(fieldEditRecorded(flagged).actorSourceLabel, "The actor was named with --actor.");
  const envFx = createAdapter({ bin: BIN, dir: fx.dir, cwd: fx.root, env: { ...fx.env, BACKLOG_ACTOR: ACTOR } });
  const env = await envFx.set("TASK-1", "epic", "Payments");
  assert.equal(env.actor, ACTOR);
  assert.equal(env.actorSource, "env");
  const recorded = fieldEditRecorded(env);
  assert.equal(recorded.actorSource, "env");
  assert.ok(recorded.actorText.startsWith(`${FIELD_EDIT_TEXT.recordedActor} ${ACTOR}. The actor was taken from $BACKLOG_ACTOR.`), recorded.actorText);
  assert.equal(historyOf(fx, "TASK-1").at(-1).actor, ACTOR);
});

test("every panel write passes --require-actor, and a success that does not report a stated actorSource is a contract mismatch", async () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-ui-actor-source-"));
  roots.push(root);
  const success = {
    take: { kind: "task-take", ok: true, taken: true, id: "TASK-1", task: { id: "TASK-1", status: "in_progress", owner: "local:me" }, lock: { actor: "local:me" } },
    release: { kind: "task-release", ok: true, id: "TASK-1", status: "pending", owner: "", released: true, comment: "C1" },
    handoff: { kind: "task-handoff", ok: true, id: "TASK-1", role: { from: "", to: "reviewer" }, comment: { id: "C1", actor: "local:me" } },
    set: { kind: "task-set", ok: true, id: "TASK-1", file: "f", field: "epic", value: "x", actor: "local:me", changes: [] },
  };
  const calls = {
    take: a => a.take("TASK-1"),
    release: a => a.release("TASK-1", { reason: "why" }),
    handoff: a => a.handoff("TASK-1", { role: "reviewer", reason: "why" }),
    set: a => a.set("TASK-1", "epic", "x"),
  };
  for (const [name, envelope] of Object.entries(success)) {
    const answer = source => JSON.stringify({ schemaVersion: 1, ...envelope, ...(source === undefined ? {} : { actorSource: source }), refusalKind: null, refusal: null, details: [] });
    // Positive control: a stated source is accepted, and the flag was passed.
    for (const source of ["flag", "env", "config"]) {
      const stub = stubBin(root, `${name}-${source}`, answer(source));
      const got = await calls[name](createAdapter({ bin: stub.file, dir: root }));
      assert.equal(got.actorSource, source, `${name} ${source}`);
      const argv = stub.calls().join(" ");
      assert.match(argv, /--require-actor/, `${name} passes --require-actor`);
      assert.doesNotMatch(argv, /--actor\b/, `${name} names no actor of its own`);
    }
    // No actorSource (a build without TL-544), or the default the flag exists to refuse.
    for (const [label, source] of [["unsourced", undefined], ["default", "default"], ["unknown", "elsewhere"]]) {
      const stub = stubBin(root, `${name}-${label}`, answer(source));
      await assert.rejects(calls[name](createAdapter({ bin: stub.file, dir: root })), ContractMismatch, `${name} ${label}`);
    }
  }
});

// --- the view model --------------------------------------------------------------------

test("validateFieldEdit accepts { id, field, value, reason? }, trimmed, an empty value included, and never an actor", () => {
  assert.deepEqual(validateFieldEdit({ id: "TASK-1", field: "priority", value: " P1 ", reason: " why " }), { ok: true, value: { id: "TASK-1", field: "priority", value: "P1", reason: "why" } });
  assert.deepEqual(validateFieldEdit({ id: "TASK-1", field: "epic", value: "" }), { ok: true, value: { id: "TASK-1", field: "epic", value: "" } });
  assert.deepEqual(validateFieldEdit({ id: "TASK-1", field: "epic", value: "x", reason: "  " }), { ok: true, value: { id: "TASK-1", field: "epic", value: "x" } });
  assert.deepEqual(validateFieldEdit({ id: "TASK-1", field: "title", value: " -x" }), { ok: true, value: { id: "TASK-1", field: "title", value: "-x" } }, "a value may start with '-'; set takes it after --");
  const refused = [
    [{ id: "TASK-1", field: "priority", value: "P1", actor: "local:x" }, null, /actor/],
    [{ id: "TASK-1", field: "priority", value: "P1", extra: 1 }, null, /Unknown field "extra"/],
    [{ id: "nope", field: "priority", value: "P1" }, "id", /not a task id/],
    [{ id: "TASK-1", field: "Priority", value: "P1" }, "field", /not a field name/],
    [{ id: "TASK-1", field: "priority", value: 1 }, "value", /text/],
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

test("fieldCommand names the set command, never an --actor and always --require-actor", () => {
  assert.equal(fieldCommand("TASK-1", "priority", "P1").text, "branchling set TASK-1 priority P1 --require-actor");
  assert.equal(fieldCommand("TASK-1", "labels", "a, b", "why not").text, 'branchling set TASK-1 labels "a, b" --reason "why not" --require-actor');
  assert.equal(fieldCommand("TASK-1", "epic", "").text, 'branchling set TASK-1 epic "" --require-actor');
  assert.ok(!fieldCommand("TASK-1", "epic", "x", "y").text.includes("--actor"));
});

test("the fields from branchling: fieldEdits draws a pen for each field set --fields reports, in its order, with the current values", async () => {
  const fx = await fixture();
  await fx.adapter.set("TASK-1", "labels", "billing, risk");
  await fx.adapter.set("TASK-1", "confidence", "high");
  await fx.adapter.set("TASK-1", "blocks", "TASK-4");
  const answer = await readTask(fx.adapter, "TASK-1");
  const described = await fx.adapter.setFields();
  assert.deepEqual(answer.fields, described.fields, "readTask composes set --fields unchanged");
  const edits = fieldEdits(answer);
  assert.ok(edits.length > 0, "positive control");
  assert.deepEqual(edits.map(e => e.key), described.fields.map(f => f.name));
  assert.ok(!edits.some(e => e.key === "status" || e.key === "owner"));
  const of = key => edits.find(e => e.key === key);
  assert.equal(of("priority").current, "P2");
  assert.equal(of("title").current, "Receipts are emailed after payment");
  assert.deepEqual([of("labels").list, of("labels").current], [true, "billing, risk"]);
  assert.equal(of("epic").known, true);
  assert.equal(of("epic").display, "(empty)");
  // TL-543: both are in the reads now, so the box starts from the value.
  assert.deepEqual([of("confidence").known, of("confidence").current], [true, "high"]);
  assert.deepEqual([of("blocks").known, of("blocks").current], [true, "TASK-4"]);
  assert.ok(edits.every(e => e.known), edits.filter(e => !e.known).map(e => e.key).join(", "));
  // What branchling says about each field reaches the box's hint.
  assert.deepEqual(of("executor").values, ["human", "agent"]);
  assert.match(of("executor").hint, /One of: human, agent\./);
  assert.match(of("labels").hint, /comma-separated/);
  assert.match(of("priority").hint, /may not be empty/);
  assert.match(of("epic").hint, /empty value clears it/);
  for (const s of strings(edits)) assert.ok(!/[<\x1b]/.test(s), s);
});

test("the fields from branchling: a field the panel has no label for is offered all the same, under its own name", async () => {
  const fx = await fixture();
  const answer = await readTask(fx.adapter, "TASK-1");
  const future = { name: "due_date", list: false, clearable: true, vocabulary: null, suggestions: null, values: null };
  assert.equal(FIELD_LABELS[future.name], undefined, "the fixture field really is unlabelled");
  const edits = fieldEdits({ ...answer, fields: [...answer.fields, future] });
  const added = edits.at(-1);
  assert.deepEqual([added.key, added.label, added.known, added.display], ["due_date", "Due date", false, "not reported"]);
  // And a label for a field branchling does not report draws nothing.
  const fewer = fieldEdits({ ...answer, fields: answer.fields.filter(f => f.name !== "epic") });
  assert.ok(!fewer.some(e => e.key === "epic"));
  assert.equal(fieldLabel("epic"), "Epic", "the label is still there; only membership changed");
});

test("a missing reason marks the reason box, an unknown value the value box, and other refusals neither", () => {
  const refusal = (refusalKind, extra = {}) => ({
    error: { type: "refusal", refusalKind, message: "m", envelope: { kind: "task-set", ok: false, refusalKind, refusal: "m", details: [], ...extra } },
  });
  assert.deepEqual(fieldEditFailure(refusal("reason-required"), 409).fix, { field: "reason", message: FIELD_EDIT_TEXT.reasonRequired, declared: [] });
  const unknown = fieldEditFailure(refusal("unknown-value", { rejected: { field: "executor", value: "robot" }, declared: ["human", "agent"] }), 409);
  assert.deepEqual(unknown.fix, { field: "value", message: 'Executor cannot be "robot" in this backlog. Use one of: human, agent.', declared: ["human", "agent"] });
  assert.equal(fieldEditFailure(refusal("usage"), 409).fix, null);
  assert.equal(fieldEditFailure({ error: { type: "unreachable", message: "x" } }, 502).fix, undefined, "not a refusal: no fix key at all");
});

test("fieldEditRecorded says when branchling recorded nothing because the value already was that", () => {
  const model = fieldEditRecorded({ kind: "task-set", ok: true, id: "TASK-1", field: "estimate", value: "2h", actor: "local:maja", changes: [] });
  assert.equal(model.changes.length, 0);
  assert.match(model.message, /already was 2h; branchling recorded nothing/);
  const none = fieldEditRecorded({ kind: "task-set", ok: true, id: "TASK-1", field: "epic", value: "x", changes: [{ field: "epic", from: "", to: "x" }] });
  assert.equal(none.actorKnown, false);
  assert.deepEqual(none.changes.map(c => c.text), ["Epic: (empty) → x"]);
});

// --- declared values (UI-43) --------------------------------------------------------------

test("declared values: the panel offers a closed vocabulary's declared values as a choice, read from the vocabulary envelope", async () => {
  const fx = await fixture();
  const answer = await readTask(fx.adapter, "TASK-1");
  const vocabulary = await fx.adapter.vocabulary();
  assert.deepEqual(answer.vocabulary, vocabulary, "readTask composes the vocabulary envelope unchanged");
  const edits = fieldEdits(answer);
  const of = key => edits.find(e => e.key === key);
  const offered = key => of(key).options.map(o => o.value);

  // priority: a closed vocabulary, not clearable: exactly the declared values, the current one selected.
  assert.equal(of("priority").vocabulary, "priorities");
  assert.equal(of("priority").control, "select");
  assert.deepEqual(of("priority").choices, vocabulary.priorities);
  assert.deepEqual(offered("priority"), vocabulary.priorities);
  assert.deepEqual(of("priority").options.filter(o => o.selected).map(o => o.value), ["P2"]);
  assert.match(of("priority").hint, /Choose one of the values this backlog declares\./);

  // role: the roles the fixture declares, clearable, so an empty entry comes first.
  assert.equal(of("role").control, "select");
  assert.deepEqual(of("role").choices, ROLES);
  assert.deepEqual(offered("role"), ["", ...ROLES]);
  assert.equal(of("role").options[0].label, FIELD_EDIT_TEXT.empty);

  // board: entries named by slug.
  assert.deepEqual(of("board").choices, vocabulary.boards.map(b => b.slug));

  // A list with a closed vocabulary is a group of boxes; this backlog declares no deploy targets.
  assert.equal(of("target").control, "checkboxes");
  assert.deepEqual(of("target").choices, []);
  assert.match(of("target").hint, /declares no values for it/);

  // A suggested key stays free text, with the declared values as suggestions.
  assert.equal(of("estimate").control, "text");
  assert.deepEqual(of("estimate").suggested, vocabulary.estimates);
  assert.match(of("estimate").hint, /another value may be typed/);

  // A field with no vocabulary stays free text; the tool's own vocabulary is a choice too.
  assert.equal(of("title").control, "text");
  assert.deepEqual(of("title").options, []);
  assert.equal(of("executor").control, "select");
  assert.deepEqual(offered("executor"), ["", "human", "agent"]);

  // Positive control: a declared value chosen in the panel is accepted by branchling.
  assert.equal((await fx.adapter.set("TASK-1", "priority", of("priority").choices[0])).value, vocabulary.priorities[0]);
  for (const str of strings(edits)) assert.ok(!/[<\x1b]/.test(str), str);
});

test("declared values: a backlog with its own priorities offers those, not branchling's defaults", async () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-ui-declared-"));
  roots.push(root);
  const fx = await buildVocabularyBacklog(join(root, "repo"), { bin: BIN });
  const real = createAdapter({ bin: BIN, dir: fx.dir, cwd: fx.root, env: fx.env });
  // The fixture holds no task (see its header): the task reads are stand-ins,
  // the two reads under test, set --fields and vocabulary, are the real executable's.
  const adapter = {
    show: async () => ({ id: "TASK-1", title: "t", status: "todo", priority: "high", executor: "" }),
    log: async () => ({ entries: [] }),
    query: async () => ({ tasks: [] }),
    setFields: () => real.setFields(),
    vocabulary: () => real.vocabulary(),
  };
  const answer = await readTask(adapter, "TASK-1");
  assert.deepEqual(answer.vocabulary.priorities, PRIORITIES, "positive control: the fixture's vocabulary was read");
  const priority = fieldEdits(answer).find(e => e.key === "priority");
  assert.equal(priority.control, "select");
  assert.deepEqual(priority.options.map(o => o.value), PRIORITIES);
  assert.ok(!priority.options.some(o => /^P\d$/.test(o.value)), "no default priority is hard-coded");
  assert.deepEqual(priority.options.filter(o => o.selected).map(o => o.value), ["high"]);
});

test("declared values: free text where the executable has no vocabulary, and a current value no longer declared is kept", () => {
  const fields = [
    { name: "priority", list: false, clearable: false, vocabulary: "priorities", suggestions: null, values: null },
    { name: "target", list: true, clearable: true, vocabulary: "deploy_targets", suggestions: null, values: null },
    { name: "release", list: false, clearable: true, vocabulary: "releases", suggestions: null, values: null },
  ];
  const base = { kind: "task-panel", composed: true, id: "TASK-1", log: {}, task: null, blocks: [], fields, body: null };
  const show = { priority: "P9", target: ["web", "gone"], release: "" };

  // A build without the vocabulary command: nothing is known, every box is text.
  const old = fieldEdits({ ...base, show, vocabulary: null });
  assert.deepEqual(old.map(e => e.control), ["text", "text", "text"]);
  assert.ok(old.every(e => e.choices === null && e.options.length === 0));

  const vocabulary = {
    priorities: ["P0", "P1"],
    deploy_targets: [{ name: "web", repository: "r", paths: [], stages: [] }, { name: "api", repository: "r", paths: [], stages: [] }],
    releases: [{ name: "v1", ref: null }],
  };
  const [priority, target, release] = fieldEdits({ ...base, show, vocabulary });
  assert.deepEqual(priority.options.map(o => [o.value, o.selected, o.declared]), [["P0", false, true], ["P1", false, true], ["P9", true, false]]);
  assert.equal(priority.options.at(-1).label, "P9 (not declared)");
  assert.equal(choiceValue(priority.options), "P9", "opening the form changes nothing");
  assert.equal(target.control, "checkboxes");
  assert.deepEqual(target.options.map(o => [o.value, o.selected]), [["web", true], ["api", false], ["gone", true]]);
  assert.equal(choiceValue(target.options), "web, gone");
  assert.equal(choiceValue(target.options.map(o => ({ ...o, selected: false }))), "", "unticking every box clears the list");
  assert.deepEqual(release.options.map(o => [o.value, o.selected]), [["", true], ["v1", false]]);

  // A key the envelope does not carry is unknown, not empty.
  assert.equal(declaredValues(vocabulary, "roles"), null);
  assert.deepEqual(declaredValues({ roles: [] }, "roles"), []);
  assert.deepEqual(declaredValues({ boards: [{ slug: "main", name: "Main" }] }, "boards"), ["main"]);
});
