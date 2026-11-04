/**
 * The decisions view (UI-5, UI-23): listDecisions() and adapter.decide(), the
 * /api/decisions and /api/decide routes behind the write guard, and the
 * decisions view model, against the REAL branchling executable over a fixture
 * backlog built in a temporary directory. Requests go through node:http,
 * because fetch cannot set the Host header the guard judges.
 *
 * The fixture, built with branchling's own commands:
 *
 *   TASK-1  stopped with `ask`, two options, the first recommended
 *   TASK-2  stopped with `ask`, no options
 *   TASK-3  never asked anything (the positive control for "not listed")
 *
 * The fixture's adapter runs branchling with `$BACKLOG_ACTOR` set to ANSWERER,
 * as the environment of a person who configured who they are: decide() always
 * passes `--require-actor`, so without it every answer would be refused.
 *
 * A test that records an answer builds its own fixture; the tests that only
 * read or are refused share one (`shared()`), and each of those asserts that
 * nothing was decided. So the order the tests run in does not matter.
 */

import "./fixtures/private-homes.mjs";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAdapter, listDecisions, run, BranchlingRefusal, BranchlingUsageError, ContractMismatch } from "../src/adapter.mjs";
import { createServer, CAPABILITY_HEADER, MAX_BODY_BYTES } from "../src/server.mjs";
import { createCache, servedFromCache } from "../src/cache.mjs";
import { argvShim, fixtureEnv } from "./fixtures/env.mjs";
import { ageOf, decisionRecorded, decisionsFailure, decisionsModel, DECISIONS_TEXT, validateDecision } from "../src/view-model/decisions.mjs";

const BIN = process.env.BRANCHLING_BIN || "branchling";
const BODY = JSON.stringify({
  goal: "A fixture task exists.",
  verification: [{ id: "noop", bash: "true", proves: "The fixture can be closed." }],
});
const roots = [];
/** The actor the fixture adapter's environment names. */
const ANSWERER = "local:answerer";

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function branchling(root, args, opts) {
  const { code, stdout, stderr } = await run(BIN, args, { cwd: root, env: fixtureEnv(root), ...opts });
  assert.equal(code, 0, `branchling ${args.join(" ")} exited ${code}: ${stderr}`);
  return stdout;
}

/** A fresh fixture backlog; resolves to its paths, adapter and question ids. */
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "branchling-ui-decisions-"));
  roots.push(root);
  const dir = join(root, "backlog");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  await branchling(root, ["init", "--dir", dir, "--no-example", "--no-nudge"]);
  for (const title of ["Pick a database", "Ship the beta", "Untouched task"]) {
    await branchling(root, ["new", "--title", title, "--priority", "P1", "--dir", dir], { input: BODY });
  }
  const asked1 = JSON.parse(await branchling(root, [
    "ask", "TASK-1", "--question", "Which database should the cache use?",
    "--option", "Postgres: already deployed, solid", "--option", "SQLite: quickest to start",
    "--recommend", "1", "--json", "--dir", dir,
  ]));
  const asked2 = JSON.parse(await branchling(root, ["ask", "TASK-2", "--question", "Is the beta ready to ship?", "--json", "--dir", dir]));
  assert.equal(asked1.kind, "task-ask");
  return {
    root, dir,
    adapter: createAdapter({ bin: BIN, dir, cwd: root, env: { BACKLOG_ACTOR: ANSWERER } }),
    q1: asked1.question.id,
    q2: asked2.question.id,
  };
}

/** The ids of the open questions `log --decisions` reports for one task. */
async function openQuestionIds(fx, id) {
  const log = await fx.adapter.raw(["log", id, "--decisions"], "task-log");
  return log.exchanges.flatMap(x => x.messages.filter(m => m.kind === "question").map(m => m.id));
}

let sharedFixture;
/** The fixture the read-only and refused tests share, built once. */
function shared() {
  sharedFixture ??= fixture();
  return sharedFixture;
}

/** A fake executable that prints `out` and exits `code`. */
function fakeBin(where, name, out, code) {
  const file = join(where, process.platform === "win32" ? `${name}.cmd` : name);
  if (process.platform === "win32") writeFileSync(file, `@echo ${out}\r\n@exit /b ${code}\r\n`);
  else writeFileSync(file, `#!/bin/sh\necho '${out}'\nexit ${code}\n`);
  chmodSync(file, 0o755);
  return file;
}

/** One request to `srv` with exactly these headers and this body. */
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

/** The server as bin/branchling-ui.mjs builds it: reads go through UI-2's cache. */
async function serve(fx, adapter = fx.adapter, changes) {
  const cached = servedFromCache(createCache(adapter, { dir: fx.dir, cwd: fx.root, changes }));
  const server = await createServer({ adapter: cached, port: 0, log: () => {} });
  const page = await call(server);
  const token = page.text.match(/name="branchling-ui-capability" content="([^"]+)"/)[1];
  const host = `127.0.0.1:${server.port}`;
  const post = (value, headers = {}) => call(server, {
    method: "POST",
    path: "/api/decide",
    headers: { host, origin: `http://${host}`, [CAPABILITY_HEADER]: token, "content-type": "application/json", ...headers },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
  return { server, token, host, post };
}

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

// --- the proof (acceptance criterion) -----------------------------------------

test("a task stopped with ask is listed, answering it through the view runs decide, and then it is gone", async () => {
  const fx = await fixture();
  const { server, post } = await serve(fx);
  try {
    const before = await call(server, { path: "/api/decisions" });
    assert.equal(before.status, 200);
    assert.equal(before.json.kind, "open-questions", "branchling's own envelope, not one composed here");
    assert.equal(before.json.schemaVersion, 1);
    const model = decisionsModel(before.json, {}, Date.now());
    assert.equal(model.state, "ready");
    const q1 = model.questions.find(q => q.taskId === "TASK-1");
    assert.ok(q1, "TASK-1 is listed");
    assert.equal(q1.title, "Pick a database");
    assert.equal(q1.text, "Which database should the cache use?");
    assert.equal(q1.questionId, fx.q1);
    assert.match(q1.askedBy, /^[a-z]+:.+/);
    assert.match(q1.ageLabel, /^asked /);
    // The options the asker offered reach the view, numbered as --choose counts them.
    assert.equal(q1.optionsKnown, true);
    assert.deepEqual(q1.options.map(o => [o.number, o.text, o.recommended]), [
      [1, "Postgres: already deployed, solid", true],
      [2, "SQLite: quickest to start", false],
    ]);
    assert.equal(q1.optionsNote, null);
    assert.equal(q1.commands.choose.endsWith("--choose N --require-actor"), true);
    // Positive control for the menu: a question asked without --option offers none, and says so.
    const q2 = model.questions.find(q => q.taskId === "TASK-2");
    assert.deepEqual(q2.options, []);
    assert.equal(q2.optionsNote, DECISIONS_TEXT.noOptions);
    // Positive control for "not listed": a task with no question is absent.
    assert.equal(model.questions.some(q => q.taskId === "TASK-3"), false);
    assert.deepEqual(model.questions.map(q => q.taskId).sort(), ["TASK-1", "TASK-2"]);

    const answered = await post({ id: "TASK-1", resolves: fx.q1, choose: 1 });
    assert.equal(answered.status, 200, answered.text);
    assert.equal(answered.json.ok, true);
    assert.equal(answered.json.decision.resolves, fx.q1);
    // The option's TEXT is what branchling records.
    assert.equal(answered.json.decision.text, "Postgres: already deployed, solid");
    // Recorded under the actor the environment named, and branchling says so.
    assert.equal(answered.json.decision.actor, ANSWERER);
    assert.equal(answered.json.actorSource, "env");
    assert.equal(decisionRecorded(answered.json).actorSourceLabel, "The actor was taken from $BACKLOG_ACTOR.");
    assert.deepEqual(await openQuestionIds(fx, "TASK-1"), []);

    const after = decisionsModel((await call(server, { path: "/api/decisions" })).json, {}, Date.now());
    assert.equal(after.questions.some(q => q.taskId === "TASK-1"), false, "TASK-1 is no longer listed");
    assert.deepEqual(after.questions.map(q => q.taskId), ["TASK-2"], "the other question is still there");

    // A free-text answer empties the list.
    const typed = await post({ id: "TASK-2", resolves: fx.q2, reason: "  Yes, ship it on Friday.  " });
    assert.equal(typed.status, 200, typed.text);
    assert.equal(typed.json.decision.text, "Yes, ship it on Friday.");
    const empty = decisionsModel((await call(server, { path: "/api/decisions" })).json, {}, Date.now());
    assert.equal(empty.state, "empty");
    assert.equal(empty.emptyText, "Nothing is waiting on a decision.");
  } finally {
    await server.close();
  }
});

test("the decisions list is read through the cache, and an answer invalidates it", async () => {
  const fx = await fixture();
  const calls = { query: 0, log: 0, openQuestions: 0 };
  const counting = {
    ...fx.adapter,
    query: (...args) => { calls.query++; return fx.adapter.query(...args); },
    log: (...args) => { calls.log++; return fx.adapter.log(...args); },
    openQuestions: (...args) => { calls.openQuestions++; return fx.adapter.openQuestions(...args); },
  };
  // A backlog written a moment ago is too fresh for the file fingerprint to
  // vouch for (RACY_MS), so the cache would never answer from memory here. A
  // fixed token isolates what this test is about: only the write itself can
  // make the next read spawn again.
  const { server, post } = await serve(fx, counting, { token: async () => "unchanged" });
  try {
    const first = await call(server, { path: "/api/decisions" });
    assert.equal(first.status, 200);
    assert.ok(first.headers["x-branchling-ui-fetched-at"], "the answer says how old it is");
    const spawned = { ...calls };
    assert.deepEqual(spawned, { query: 0, log: 0, openQuestions: 1 }, "one listing read, no read per task");

    // Nothing changed: the second read spawns nothing (positive control above).
    const second = await call(server, { path: "/api/decisions" });
    assert.deepEqual(second.json, first.json);
    assert.deepEqual(calls, spawned);

    const answered = await post({ id: "TASK-1", resolves: fx.q1, choose: 1 });
    assert.equal(answered.status, 200, answered.text);

    // The write invalidated the cache: the list is read again, without TASK-1.
    const after = await call(server, { path: "/api/decisions" });
    assert.equal(calls.openQuestions, 2, "the list was read again after the answer");
    assert.deepEqual(after.json.questions.map(q => q.task), ["TASK-2"]);
  } finally {
    await server.close();
  }
});

// --- the write guard ---------------------------------------------------------------

test("an answer without the token or from a foreign origin or host is 403 and decides nothing", async () => {
  const fx = await fixture();
  const { server, token, host, post } = await serve(fx);
  try {
    const answer = { id: "TASK-1", resolves: fx.q1, choose: 1 };
    const refused = [
      ["no token", { [CAPABILITY_HEADER]: "" }],
      ["wrong token", { [CAPABILITY_HEADER]: "x".repeat(token.length) }],
      ["foreign origin", { origin: "http://evil.example" }],
      ["no origin", { origin: "" }],
      ["foreign host", { host: `evil.example:${server.port}`, origin: `http://evil.example:${server.port}` }],
    ];
    for (const [name, headers] of refused) {
      const res = await post(answer, headers);
      assert.equal(res.status, 403, name);
      assert.equal(res.json.error.type, "forbidden", name);
    }
    assert.deepEqual(await openQuestionIds(fx, "TASK-1"), [fx.q1], "nothing was decided");
    // Positive control: the same answer with the right headers is recorded.
    const ok = await post(answer);
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(await openQuestionIds(fx, "TASK-1"), []);
    assert.ok(host);
  } finally {
    await server.close();
  }
});

// --- refusals and malformed answers -------------------------------------------------

test("a decide refusal comes back as the refusal, its text unchanged, never as success", async () => {
  const fx = await shared();
  const { server, post } = await serve(fx);
  try {
    // A well-formed event id that is not in TASK-1's history.
    const wrong = fx.q2;
    let direct;
    await assert.rejects(fx.adapter.decide({ id: "TASK-1", resolves: wrong, choose: 1 }), err => { direct = err; return err instanceof BranchlingRefusal; });
    assert.equal(direct.envelope.refusalKind, "unknown-event");

    const res = await post({ id: "TASK-1", resolves: wrong, choose: 1 });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.type, "refusal");
    assert.equal(res.json.error.refusalKind, "unknown-event");
    assert.equal(res.json.error.message, direct.message, "branchling's text, unchanged");
    assert.match(res.json.error.message, new RegExp(wrong));
    assert.equal(res.json.decision, undefined);
    const shown = decisionsFailure(res.json, res.status);
    assert.equal(shown.state, "refusal");
    assert.equal(shown.detail, direct.message);
    assert.deepEqual(shown.details, direct.envelope.details);

    // An option that does not exist: branchling lists the menu in its details.
    const range = await post({ id: "TASK-1", resolves: fx.q1, choose: 9 });
    assert.equal(range.status, 409);
    assert.equal(range.json.error.refusalKind, "option-range");
    assert.ok(range.json.error.envelope.details.some(line => line.includes("Postgres")));

    assert.deepEqual(await openQuestionIds(fx, "TASK-1"), [fx.q1], "nothing was decided");
  } finally {
    await server.close();
  }
});

test("a malformed answer is a 400 before branchling is called, an actor field included", async () => {
  const fx = await shared();
  const { server, post } = await serve(fx);
  try {
    const cases = [
      ["actor from the page", { id: "TASK-1", resolves: fx.q1, choose: 1, actor: "user:mallory" }, /actor is not taken from the page/],
      ["both", { id: "TASK-1", resolves: fx.q1, choose: 1, reason: "x" }, /not both/],
      ["neither", { id: "TASK-1", resolves: fx.q1 }, /not both and not neither/],
      ["flag-shaped id", { id: "--dir", resolves: fx.q1, choose: 1 }, /cannot start with "-"/],
      ["choose as text", { id: "TASK-1", resolves: fx.q1, choose: "1" }, /whole number/],
      ["unknown field", { id: "TASK-1", resolves: fx.q1, choose: 1, extra: true }, /Unknown field/],
      ["not an object", [1, 2], /JSON object/],
      ["too long", { id: "TASK-1", resolves: fx.q1, reason: "a".repeat(2001) }, /longer than 2000/],
    ];
    for (const [name, value, message] of cases) {
      const res = await post(value);
      assert.equal(res.status, 400, name);
      assert.equal(res.json.error.type, "bad-request", name);
      assert.match(res.json.error.message, message, name);
    }
    const notJson = await post("{nope");
    assert.equal(notJson.status, 400);
    assert.equal(notJson.json.error.type, "bad-request");
    const wrongType = await post(JSON.stringify({ id: "TASK-1", resolves: fx.q1, choose: 1 }), { "content-type": "text/plain" });
    assert.equal(wrongType.status, 415);
    assert.equal(wrongType.json.error.type, "unsupported-media-type");
    const huge = await post(JSON.stringify({ id: "TASK-1", resolves: fx.q1, reason: "a".repeat(MAX_BODY_BYTES) }));
    assert.equal(huge.status, 413);
    assert.equal(huge.json.error.type, "payload-too-large");
    assert.deepEqual(await openQuestionIds(fx, "TASK-1"), [fx.q1], "nothing was decided");
  } finally {
    await server.close();
  }
});

// --- adapter contract ----------------------------------------------------------------

test("listDecisions returns branchling's open-questions envelope, options included", async () => {
  const fx = await shared();
  const answer = await listDecisions(fx.adapter);
  assert.equal(answer.schemaVersion, 1);
  assert.equal(answer.kind, "open-questions");
  assert.equal(answer.total, 2);
  assert.deepEqual(answer.questions.map(q => q.task).sort(), ["TASK-1", "TASK-2"]);
  // The keys the view model reads.
  for (const q of answer.questions) {
    for (const key of ["task", "title", "status", "event", "question", "askedBy", "askedAt", "options", "recommend"]) assert.ok(key in q, key);
  }
  const q1 = answer.questions.find(q => q.task === "TASK-1");
  assert.equal(q1.title, "Pick a database");
  assert.equal(q1.event, fx.q1);
  assert.deepEqual(q1.options, ["Postgres: already deployed, solid", "SQLite: quickest to start"]);
  assert.equal(q1.recommend, 1);
  const q2 = answer.questions.find(q => q.task === "TASK-2");
  assert.deepEqual(q2.options, []);
  assert.equal(q2.recommend, null);
  // Positive control for "not listed": TASK-3 exists and is active.
  assert.equal((await fx.adapter.query()).tasks.some(t => t.id === "TASK-3"), true);
});

test("the decisions list is one branchling spawn, not one per task", async t => {
  const fx = await shared();
  const where = mkdtempSync(join(tmpdir(), "branchling-ui-decisions-argv-"));
  t.after(() => rmSync(where, { recursive: true, force: true }));
  const shim = argvShim(where);
  const answer = await listDecisions(createAdapter({ bin: shim.bin, dir: fx.dir, cwd: fx.root }));
  // Positive control: the one spawn answered the whole list, across tasks.
  assert.equal(answer.questions.length, 2);
  const calls = shim.calls();
  assert.equal(calls.length, 1, calls.join("\n"));
  assert.match(calls[0], /^log --open-questions --json --dir /);
});

test("an open-questions entry the decisions view cannot answer is a contract mismatch, never a shorter list", async t => {
  const where = mkdtempSync(join(tmpdir(), "branchling-ui-decisions-fake-"));
  t.after(() => rmSync(where, { recursive: true, force: true }));
  const entry = { task: "TASK-1", title: "T", status: "blocked", event: "01M6ED5HQT4XQGR5KGY17S4JER", question: "Which?", askedBy: "agent:x", askedAt: "2026-11-02T15:13:41.626Z", options: ["a", "b"], recommend: 2 };
  const envelope = questions => JSON.stringify({ schemaVersion: 1, kind: "open-questions", root: "/r", total: questions.length, questions });
  const list = (name, out) => listDecisions(createAdapter({ bin: fakeBin(where, name, out, 0) }));

  // Positive control: the same fake with a well-formed entry is accepted unchanged.
  assert.deepEqual((await list("fake-oq-ok", envelope([entry]))).questions, [entry]);
  const broken = [
    ["fake-oq-no-list", JSON.stringify({ schemaVersion: 1, kind: "open-questions", root: "/r", total: 0 })],
    ["fake-oq-no-task", envelope([{ ...entry, task: "" }])],
    ["fake-oq-flag-task", envelope([{ ...entry, task: "-x" }])],
    ["fake-oq-no-event", envelope([{ ...entry, event: null }])],
    ["fake-oq-no-options", envelope([{ ...entry, options: undefined }])],
    ["fake-oq-recommend-out", envelope([{ ...entry, recommend: 3 }])],
    ["fake-oq-old-kind", JSON.stringify({ schemaVersion: 1, kind: "task-log", exchanges: [] })],
  ];
  for (const [name, out] of broken) await assert.rejects(list(name, out), ContractMismatch, name);
});

test("adapter.decide records with --choose, --reason and a stated actor, and refuses as branchling does", async () => {
  const fx = await fixture();
  const chosen = await fx.adapter.decide({ id: "TASK-1", resolves: fx.q1, choose: 2 });
  assert.equal(chosen.ok, true);
  assert.equal(chosen.id, "TASK-1");
  assert.equal(chosen.decision.text, "SQLite: quickest to start");
  assert.equal(chosen.decision.resolves, fx.q1);
  assert.deepEqual(chosen.openQuestions, []);
  assert.equal(chosen.decision.actor, ANSWERER);
  assert.equal(chosen.actorSource, "env");

  // A stated actor is passed through (the server never states one).
  const typed = await fx.adapter.decide({ id: "TASK-2", resolves: fx.q2, reason: "Not yet.", actor: "local:fixture" });
  assert.equal(typed.decision.actor, "local:fixture");
  assert.equal(typed.actorSource, "flag");
  assert.equal(typed.decision.text, "Not yet.");

  // An unknown task is branchling's refusal, not a usage error.
  await assert.rejects(fx.adapter.decide({ id: "TASK-99", resolves: fx.q1, reason: "x" }),
    err => err instanceof BranchlingRefusal && err.envelope.refusalKind === "not-found");
  // A malformed event id is branchling's usage error (no JSON at all).
  await assert.rejects(fx.adapter.decide({ id: "TASK-1", resolves: "NOPE", reason: "x" }), BranchlingUsageError);
  // A flag-shaped id never reaches branchling (an answer may start with "-"; see below).
  await assert.rejects(fx.adapter.decide({ id: "TASK-1", resolves: "-x", reason: "x" }), BranchlingUsageError);
  await assert.rejects(fx.adapter.decide({ id: "-x", resolves: fx.q1, reason: "x" }), BranchlingUsageError);
  await assert.rejects(fx.adapter.decide({ id: "TASK-1", resolves: fx.q1 }), BranchlingUsageError);
});

test("a decide answer starting with \"-\" is recorded as typed, through the page and the adapter", async () => {
  const fx = await fixture();
  const { server, post } = await serve(fx);
  try {
    const typed = await post({ id: "TASK-2", resolves: fx.q2, reason: "-1 for shipping now; wait a week" });
    assert.equal(typed.status, 200, typed.text);
    assert.equal(typed.json.decision.text, "-1 for shipping now; wait a week");
  } finally {
    await server.close();
  }
  // Text that is exactly a flag of decide's is still an answer, not that flag.
  const flagShaped = await fx.adapter.decide({ id: "TASK-1", resolves: fx.q1, reason: "--json" });
  assert.equal(flagShaped.decision.text, "--json");
  assert.deepEqual(await openQuestionIds(fx, "TASK-1"), []);
});

test("a decide answer with no stated actor is refused, never recorded as branchling's default", async () => {
  const fx = await fixture();
  // No $BACKLOG_ACTOR and no user config (the fixture's homes are private):
  // only branchling's default agent is left.
  const anonymous = createAdapter({ bin: BIN, dir: fx.dir, cwd: fx.root, env: { BACKLOG_ACTOR: "" } });
  let refused;
  await assert.rejects(anonymous.decide({ id: "TASK-1", resolves: fx.q1, choose: 1 }), err => { refused = err; return err instanceof BranchlingRefusal; });
  assert.equal(refused.envelope.kind, "task-decide");
  assert.equal(refused.envelope.refusalKind, "actor-required");
  assert.equal(refused.envelope.actorSource, "default");
  assert.equal(refused.code, 1);

  const { server, post } = await serve(fx, anonymous);
  try {
    const res = await post({ id: "TASK-1", resolves: fx.q1, choose: 1 });
    assert.equal(res.status, 409, res.text);
    assert.equal(res.json.error.refusalKind, "actor-required");
    assert.ok(decisionsFailure(res.json, res.status).details.length > 0, "branchling's details say how to name the actor");
  } finally {
    await server.close();
  }
  assert.deepEqual(await openQuestionIds(fx, "TASK-1"), [fx.q1], "nothing was recorded");

  // Positive control: the same adapter with an actor named records the answer.
  const named = await anonymous.decide({ id: "TASK-1", resolves: fx.q1, choose: 1, actor: "local:fixture" });
  assert.equal(named.actorSource, "flag");
  assert.deepEqual(await openQuestionIds(fx, "TASK-1"), []);
});

test("decide reads only the task-decide envelope; the 0.2 bare object is a contract mismatch", async t => {
  const where = mkdtempSync(join(tmpdir(), "branchling-ui-decide-fake-"));
  t.after(() => rmSync(where, { recursive: true, force: true }));
  const fake = (name, out, code) => fakeBin(where, name, out, code);
  const answer = { id: "TASK-1", resolves: "01M6ED5HQT4XQGR5KGY17S4JER", reason: "Yes" };
  const decision = { id: "01M6ED5HQT4XQGR5KGY17S4JES", ts: "2026-11-02T15:13:41.626Z", text: "Yes", actor: "local:me", resolves: answer.resolves, chose: null };
  const recorded = { ok: true, id: "TASK-1", decision, chosen: null, openQuestions: [], lifted: null, actorSource: "env" };
  const envelope = { schemaVersion: 1, kind: "task-decide", ...recorded, refusalKind: null, refusal: null, details: [] };

  // Positive control: the 0.3 envelope is accepted from the same kind of fake.
  const ok = await createAdapter({ bin: fake("fake-decide-ok", JSON.stringify(envelope), 0) }).decide(answer);
  assert.equal(ok.decision.id, decision.id);

  // 0.2.x printed the same keys with no schemaVersion and no kind of its own.
  await assert.rejects(createAdapter({ bin: fake("fake-decide-02", JSON.stringify(recorded), 0) }).decide(answer), ContractMismatch);
  // An envelope claiming success with no decision in it.
  const empty = { ...envelope, decision: null };
  await assert.rejects(createAdapter({ bin: fake("fake-decide-empty", JSON.stringify(empty), 0) }).decide(answer), ContractMismatch);
  // A success that does not say where its actor came from (a build without
  // TL-537), or says it was the default --require-actor exists to refuse.
  const { actorSource: _dropped, ...unsourced } = envelope;
  await assert.rejects(createAdapter({ bin: fake("fake-decide-unsourced", JSON.stringify(unsourced), 0) }).decide(answer), ContractMismatch);
  await assert.rejects(createAdapter({ bin: fake("fake-decide-default", JSON.stringify({ ...envelope, actorSource: "default" }), 0) }).decide(answer), ContractMismatch);
  // A refusal envelope is a BranchlingRefusal carrying branchling's text.
  const refused = { ...envelope, ok: false, decision: null, refusalKind: "unknown-event", refusal: "names no event", details: ["a"] };
  await assert.rejects(createAdapter({ bin: fake("fake-decide-refused", JSON.stringify(refused), 1) }).decide(answer),
    err => err instanceof BranchlingRefusal && err.message === "names no event" && err.envelope.refusalKind === "unknown-event" && err.envelope.details[0] === "a");
});

// --- the page --------------------------------------------------------------------------

test("the page serves the decisions script, its view model and its section", async () => {
  const fx = await shared();
  const { server } = await serve(fx);
  try {
    for (const path of ["/decisions.mjs", "/view-model/decisions.mjs"]) {
      const res = await call(server, { path });
      assert.equal(res.status, 200, path);
      assert.match(res.headers["content-type"], /^text\/javascript/, path);
    }
    assert.match((await call(server)).text, /id="decisions"/);
    assert.match((await call(server, { path: "/app.mjs" })).text, /decisions: "\/decisions\.mjs"/);
    assert.match((await call(server)).text, /href="\?view=decisions"/);
    const script = (await call(server, { path: "/decisions.mjs" })).text;
    assert.match(script, /X-Branchling-UI-Capability/);
    assert.doesNotMatch(script, /innerHTML/);
  } finally {
    await server.close();
  }
});

// --- the view model, without a server ---------------------------------------------------

/** An `open-questions` envelope: TASK-7's question (with `extra` merged in) and an older one on TASK-3. */
function answer(extra = {}) {
  return {
    schemaVersion: 1, kind: "open-questions", root: "/r", total: 2,
    questions: [
      { task: "TASK-3", title: "Older one", status: "blocked", event: "Q3", question: "Older question?", askedBy: "agent:claude", askedAt: "2026-10-30T10:00:00.000Z", options: [], recommend: null },
      { task: "TASK-7", title: "Choose <b>a</b> store", status: "in_progress", event: "Q7", question: "Which store?", askedBy: "agent:claude", askedAt: "2026-11-01T10:00:00.000Z", options: [], recommend: null, ...extra },
    ],
  };
}

test("the model lists open questions oldest first, with who asked, when and how long ago", () => {
  const now = Date.parse("2026-11-02T10:30:00.000Z");
  const model = decisionsModel(answer(), {}, now);
  assert.equal(model.state, "ready");
  assert.equal(model.count, 2);
  assert.equal(model.taskCount, 2);
  assert.equal(model.summary, "2 open questions on 2 tasks");
  assert.deepEqual(model.questions.map(q => q.key), ["TASK-3:Q3", "TASK-7:Q7"]);
  const q = model.questions[1];
  assert.equal(q.text, "Which store?");
  assert.equal(q.askedBy, "agent:claude");
  assert.equal(q.askedAt, "2026-11-01T10:00:00.000Z");
  assert.equal(q.ageMs, 24.5 * 3600 * 1000);
  assert.equal(q.ageLabel, "asked 1 d ago");
  assert.equal(q.statusLabel, "in progress");
  assert.equal(q.role, "neutral");
  assert.equal(q.needs, DECISIONS_TEXT.needs);
  // Asked with no options: a typed answer only, and the question says so.
  assert.equal(q.optionsKnown, true);
  assert.deepEqual(q.options, []);
  assert.equal(q.optionsNote, DECISIONS_TEXT.noOptions);
  // A payload without `options` (the adapter refuses one) is not shown as "none offered".
  const unknown = decisionsModel(answer({ options: undefined })).questions.find(x => x.questionId === "Q7");
  assert.equal(unknown.optionsKnown, false);
  assert.equal(unknown.optionsNote, DECISIONS_TEXT.optionsUnknown);
  // Without `now`, the age is unknown, never invented.
  assert.equal(decisionsModel(answer()).questions[0].ageLabel, "asked at an unknown time");
});

test("options are numbered as --choose counts them, the recommended one marked in text", () => {
  const model = decisionsModel(answer({ options: ["Postgres: solid", "SQLite: quick"], recommend: 1 }), {}, 0);
  const q = model.questions.find(x => x.questionId === "Q7");
  assert.deepEqual(q.options, [
    { number: 1, text: "Postgres: solid", recommended: true, label: "Postgres: solid (recommended)" },
    { number: 2, text: "SQLite: quick", recommended: false, label: "SQLite: quick" },
  ]);
  assert.equal(q.optionsNote, null);
  const none = decisionsModel(answer({ options: [] })).questions.find(x => x.questionId === "Q7");
  assert.equal(none.optionsNote, DECISIONS_TEXT.noOptions);
});

test("ages are computed from the injected now", () => {
  assert.deepEqual(ageOf("2026-11-02T10:00:00Z", "2026-11-02T10:00:30Z"), { ms: 30000, label: "asked less than a minute ago" });
  assert.equal(ageOf("2026-11-02T10:00:00Z", Date.parse("2026-11-02T10:45:00Z")).label, "asked 45 min ago");
  assert.equal(ageOf("2026-11-02T10:00:00Z", Date.parse("2026-11-02T13:10:00Z")).label, "asked 3 h ago");
  assert.deepEqual(ageOf("garbage", 0), { ms: null, label: null });
  assert.deepEqual(ageOf("2026-11-02T10:00:00Z"), { ms: null, label: null });
});

test("no open question is the empty decisions state; anything but the open-questions answer is rejected", () => {
  const model = decisionsModel({ schemaVersion: 1, kind: "open-questions", root: "/r", total: 0, questions: [] });
  assert.equal(model.state, "empty");
  assert.equal(model.emptyText, "Nothing is waiting on a decision.");
  assert.deepEqual(decisionsModel(answer(), { stale: true, fetchedAt: "2026-11-02T10:00:00Z" }).freshness, { stale: true, fetchedAt: "2026-11-02T10:00:00Z" });
  // Positive control: the same builder answers ready with a question.
  assert.equal(decisionsModel(answer()).state, "ready");
  // The answer this package composed before UI-23 is not read any more.
  assert.throws(() => decisionsModel({ kind: "decisions", composed: true, scanned: 2, tasks: [] }), TypeError);
  assert.throws(() => decisionsModel({ schemaVersion: 1, kind: "task-list", tasks: [] }), TypeError);
  assert.throws(() => decisionsModel(null), TypeError);
});

test("the decisions model is plain data with no markup or escape codes of its own", () => {
  const models = [
    decisionsModel(answer({ options: ["a", "b"], recommend: 2 }), {}, 0),
    decisionsModel({ kind: "open-questions", questions: [] }),
    decisionRecorded({ ok: true, id: "TASK-1", decision: { id: "D", text: "Yes", actor: "local:me" }, actorSource: "config", openQuestions: [{}], lifted: { from: "blocked", to: "in_progress" } }),
    decisionsFailure({ error: { type: "refusal", refusalKind: "unknown-event", message: "names no event", envelope: { details: ["open questions here: X"] } } }, 409),
  ];
  for (const model of models) {
    assert.ok(isPlainData(model));
    assert.deepEqual(JSON.parse(JSON.stringify(model)), model);
    const all = strings(model).filter(s => s !== "Choose <b>a</b> store");
    assert.ok(all.length > 2, "positive control: the model has strings to check");
    for (const s of all) {
      assert.doesNotMatch(s, /<[a-z/!]/i, `markup in ${JSON.stringify(s)}`);
      assert.doesNotMatch(s, /\x1b/, `escape code in ${JSON.stringify(s)}`);
    }
  }
  // A title from the backlog is data, passed on as text and never stripped.
  assert.equal(models[0].questions.find(q => q.taskId === "TASK-7").title, "Choose <b>a</b> store");
  const recorded = models[2];
  assert.equal(recorded.message, "Recorded for TASK-1 as local:me: Yes");
  assert.equal(recorded.liftedLabel, "Its status moved from blocked to in progress.");
  assert.equal(recorded.remainingLabel, "1 more open question on this task.");
  assert.equal(recorded.actorSource, "config");
  assert.equal(recorded.actorSourceLabel, "The actor was taken from your branchling user config.");
  // Positive control: a source this package does not know gets no label of its own.
  assert.equal(decisionRecorded({ decision: {}, actorSource: "elsewhere" }).actorSourceLabel, null);
  const source = readFileSync(new URL("../src/view-model/decisions.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /#[0-9a-f]{3,6}\b|rgb\(|hsl\(/i, "no colour values in the model");
  assert.doesNotMatch(source, /Date\.now\(|new Date\(\)/, "no clock read in the model");
});

test("validateDecision accepts exactly the two shapes, and never an actor", () => {
  assert.deepEqual(validateDecision({ id: "TASK-1", resolves: "Q", choose: 2 }), { ok: true, value: { id: "TASK-1", resolves: "Q", choose: 2 } });
  assert.deepEqual(validateDecision({ id: "TASK-1", resolves: "Q", reason: " Yes \n" }), { ok: true, value: { id: "TASK-1", resolves: "Q", reason: "Yes" } });
  assert.deepEqual(validateDecision({ id: "TASK-1", resolves: "Q", choose: null, reason: "Yes" }).ok, true);
  // An answer may start with "-": decide() passes it as one --reason=<text> word.
  assert.deepEqual(validateDecision({ id: "TASK-1", resolves: "Q", reason: "-1 for this" }), { ok: true, value: { id: "TASK-1", resolves: "Q", reason: "-1 for this" } });
  for (const bad of [
    null, "x", { id: "TASK-1", resolves: "Q", choose: 1, actor: "user:x" }, { id: "", resolves: "Q", choose: 1 },
    { id: "TASK-1", resolves: "Q", choose: 0 }, { id: "TASK-1", resolves: "Q", choose: 1.5 }, { id: "TASK-1", resolves: "Q", reason: "   " },
    { id: "TASK-1", resolves: "Q", reason: "a\u0000b" }, { id: "TASK-1\n", resolves: "Q", choose: 1 },
    { id: "-x", resolves: "Q", choose: 1 }, { id: "TASK-1", resolves: "-Q", reason: "Yes" },
  ]) {
    const result = validateDecision(bad);
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.equal(typeof result.message, "string");
  }
});
