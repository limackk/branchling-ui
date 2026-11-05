/**
 * The task panel's actions (UI-30): POST /api/task/take, /api/task/release and
 * /api/task/handoff behind the write guard, served the way
 * bin/branchling-ui.mjs serves them (through UI-2's cache), against the REAL
 * branchling executable over test/fixtures/actions-backlog.mjs. Requests go
 * through node:http, because fetch cannot set the Host header the guard
 * judges.
 *
 * Every fixture keeps branchling's state, data and config homes inside its
 * own root (fixtureEnv), so no `take` lock lands in the user's state
 * directory. The server's adapter gets the same homes plus a known
 * BACKLOG_ACTOR, except in the actor-required test, which removes it: every
 * panel write passes `--require-actor` (UI-48), so with no actor stated it is
 * refused rather than recorded as branchling's default agent.
 *
 * A test that writes builds its own fixture, so the order the tests run in
 * does not matter.
 */

import "./fixtures/private-homes.mjs";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAdapter, BranchlingRefusal } from "../src/adapter.mjs";
import { createServer, CAPABILITY_HEADER, MAX_BODY_BYTES } from "../src/server.mjs";
import { createCache, servedFromCache } from "../src/cache.mjs";
import { taskPanelModel } from "../src/view-model/task.mjs";
import {
  ACTION_LIMITS, TASK_ACTIONS_TEXT, actionCommand, actionPath, taskActionFailure, taskActionRecorded, validateTaskAction,
} from "../src/view-model/task-actions.mjs";
import { BIN, OTHER_ACTOR, ROLES, buildActionsBacklog } from "./fixtures/actions-backlog.mjs";

const ACTOR = "local:maja";
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A fresh fixture and an adapter acting as `actor` (null: branchling's own default). */
async function fixture({ actor = ACTOR } = {}) {
  const root = mkdtempSync(join(tmpdir(), "branchling-ui-actions-"));
  roots.push(root);
  const fx = await buildActionsBacklog(join(root, "repo"), { bin: BIN });
  const env = { ...fx.env, BACKLOG_ACTOR: actor };
  return { ...fx, env, adapter: createAdapter({ bin: BIN, dir: fx.dir, cwd: fx.root, env }) };
}

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

/** The server as bin/branchling-ui.mjs builds it: everything through UI-2's cache. */
async function serve(fx, adapter = fx.adapter, changes) {
  const cached = servedFromCache(createCache(adapter, { dir: fx.dir, cwd: fx.root, changes }));
  const server = await createServer({ adapter: cached, port: 0, log: () => {} });
  const page = await call(server);
  const token = page.text.match(/name="branchling-ui-capability" content="([^"]+)"/)[1];
  const host = `127.0.0.1:${server.port}`;
  const post = (action, value, headers = {}) => call(server, {
    method: "POST",
    path: actionPath(action),
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

/** A task's owner and status as branchling reports them now (show + its query row). */
async function stateOf(fx, id) {
  const show = await fx.adapter.show(id);
  const rows = (await fx.adapter.query({ text: id, status: show.status })).tasks;
  const row = rows.find(t => t.id === id);
  return { status: show.status, owner: row.owner, role: row.role };
}

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

// --- each action changes the task, and the panel is fresh after it ----------------------

test("take, release and handoff change a fixture task through branchling, and the panel is never stale after a write", async () => {
  const fx = await fixture();
  const calls = { show: 0 };
  const counting = { ...fx.adapter, show: (...args) => { calls.show++; return fx.adapter.show(...args); } };
  // A fixed token: the file fingerprint cannot vouch for a backlog written a
  // moment ago (RACY_MS), so without it nothing would be cached at all. With
  // it, only the write itself can make the next read spawn again.
  const { server, post, panel } = await serve(fx, counting, { token: async () => "unchanged" });
  try {
    const before = taskPanelModel(await panel("TASK-1"));
    assert.equal(before.status, "pending");
    const spawned = calls.show;
    await panel("TASK-1");
    assert.equal(calls.show, spawned, "positive control: an unchanged backlog is answered from the cache");

    // take
    const took = await post("take", { id: "TASK-1" });
    assert.equal(took.status, 200, took.text);
    assert.equal(took.json.kind, "task-take", "the envelope as branchling printed it");
    const afterTake = await panel("TASK-1");
    assert.ok(calls.show > spawned, "the write invalidated the cache: the panel was read again");
    const takenModel = taskPanelModel(afterTake);
    assert.equal(takenModel.status, took.json.task.status);
    assert.notEqual(takenModel.status, "pending");
    assert.equal(takenModel.fields.find(f => f.key === "owner").display, ACTOR);
    assert.equal(afterTake.log.exchanges.at(-1).source, "take");
    const tookShown = taskActionRecorded("take", took.json, afterTake);
    assert.equal(tookShown.actor, ACTOR, "the recorded actor is shown");
    assert.equal(took.json.actorSource, "env", "branchling says where the actor came from");
    assert.equal(tookShown.actorSource, "env");
    assert.equal(tookShown.actorSourceLabel, "The actor was taken from $BACKLOG_ACTOR.");
    assert.ok(tookShown.actorText.includes(tookShown.actorSourceLabel));
    assert.match(tookShown.message, /TASK-1 is taken by local:maja/);
    assert.ok(tookShown.changes.some(c => c.text === `status: pending → ${took.json.task.status.replace(/_/g, " ")}`));

    // release, with its reason
    const released = await post("release", { id: "TASK-1", reason: "  Waiting on the payment provider.  " });
    assert.equal(released.status, 200, released.text);
    assert.equal(released.json.kind, "task-release");
    const afterRelease = await panel("TASK-1");
    const releasedModel = taskPanelModel(afterRelease);
    assert.equal(releasedModel.status, "pending");
    assert.notEqual(releasedModel.fields.find(f => f.key === "owner").display, ACTOR);
    const lastRelease = afterRelease.log.exchanges.at(-1);
    assert.equal(lastRelease.reason, "Waiting on the payment provider.", "the reason reached branchling, trimmed");
    const releaseShown = taskActionRecorded("release", released.json, afterRelease);
    assert.equal(releaseShown.actor, ACTOR, "release's actor comes from the exchange carrying its comment");
    assert.equal(releaseShown.actorSource, "env");
    assert.equal(taskActionRecorded("release", released.json, null).actorKnown, false, "positive control: without the history it is not guessed");

    // handoff, to a declared role, with its reason
    const handed = await post("handoff", { id: "TASK-1", role: ROLES[1], reason: "Ready for review." });
    assert.equal(handed.status, 200, handed.text);
    assert.equal(handed.json.kind, "task-handoff");
    const afterHandoff = await panel("TASK-1");
    assert.equal(taskPanelModel(afterHandoff).fields.find(f => f.key === "role")?.display ?? afterHandoff.task.role, ROLES[1]);
    assert.equal(afterHandoff.task.role, ROLES[1]);
    const handShown = taskActionRecorded("handoff", handed.json, afterHandoff);
    assert.equal(handShown.actor, ACTOR);
    assert.equal(handShown.actorSource, "env");
    assert.match(handShown.message, /handed off to reviewer by local:maja/);
    assert.ok(handShown.actorText.includes(TASK_ACTIONS_TEXT.actorNote));
    assert.ok(isPlainData(handShown));
    for (const s of strings([tookShown, releaseShown, handShown])) assert.doesNotMatch(s, /<[a-z/!]|\x1b/i, s);
    assert.deepEqual(await stateOf(fx, "TASK-1"), { status: "pending", owner: "", role: ROLES[1] }, "branchling agrees");
  } finally {
    await server.close();
  }
});

test("with no stated actor, every panel action is refused as actor-required and nothing is written; a stated actor is recorded under it", async () => {
  // No $BACKLOG_ACTOR and no user config (the fixture's homes are private):
  // only branchling's default agent is left, which --require-actor refuses.
  const fx = await fixture({ actor: null });
  const { server, post } = await serve(fx);
  try {
    const before = { 1: await stateOf(fx, "TASK-1"), 4: await stateOf(fx, "TASK-4") };
    const historyBefore = (await fx.adapter.log("TASK-4")).exchanges.length;
    const cases = [
      ["take", { id: "TASK-4" }, () => fx.adapter.take("TASK-4")],
      ["release", { id: "TASK-4", reason: "Not now." }, () => fx.adapter.release("TASK-4", { reason: "Not now." })],
      ["handoff", { id: "TASK-1", role: ROLES[1], reason: "Ready for review." }, () => fx.adapter.handoff("TASK-1", { role: ROLES[1], reason: "Ready for review." })],
    ];
    for (const [action, value, direct] of cases) {
      let err;
      await assert.rejects(direct(), e => { err = e; return e instanceof BranchlingRefusal; });
      assert.equal(err.envelope.kind, `task-${action}`);
      assert.equal(err.envelope.refusalKind, "actor-required", action);
      assert.equal(err.envelope.actorSource, "default", `${action}: branchling says it would have used its default`);
      assert.equal(err.code, 1);

      const res = await post(action, value);
      assert.equal(res.status, 409, `${action}: ${res.text}`);
      assert.equal(res.json.error.refusalKind, "actor-required");
      assert.equal(res.json.error.message, err.message, "branchling's text, unchanged");
      const shown = taskActionFailure(action, res.json, res.status);
      assert.equal(shown.state, "refusal");
      assert.equal(shown.actorRequired, true);
      assert.equal(shown.title, TASK_ACTIONS_TEXT.actorRequiredTitle);
      assert.equal(shown.hint, TASK_ACTIONS_TEXT.actorRequiredHint);
      assert.match(shown.hint, /\$BACKLOG_ACTOR/);
      assert.equal(shown.nothingWritten, TASK_ACTIONS_TEXT.nothingWritten);
    }
    assert.deepEqual(await stateOf(fx, "TASK-1"), before[1], "nothing was handed off");
    assert.deepEqual(await stateOf(fx, "TASK-4"), before[4], "nothing was taken or released");
    assert.equal((await fx.adapter.log("TASK-4")).exchanges.length, historyBefore, "no history was written");
  } finally {
    await server.close();
  }

  // Positive control: the same backlog, with an actor stated, records it.
  const named = createAdapter({ bin: BIN, dir: fx.dir, cwd: fx.root, env: { ...fx.env, BACKLOG_ACTOR: ACTOR } });
  const took = await named.take("TASK-4");
  assert.equal(took.actorSource, "env");
  assert.equal(took.task.owner, ACTOR);
  const shown = taskActionRecorded("take", took, null);
  assert.equal(shown.actor, ACTOR);
  assert.equal(shown.actorSourceLabel, "The actor was taken from $BACKLOG_ACTOR.");
  assert.doesNotMatch(shown.actorText, /agent:claude/);
  assert.equal((await stateOf(fx, "TASK-4")).owner, ACTOR, "branchling agrees");
});

test("a refusal other than actor-required keeps the generic title and no actor hint", () => {
  const body = { error: { type: "refusal", refusalKind: "other-owner", message: "held", envelope: { details: [] } } };
  const shown = taskActionFailure("take", body, 409);
  assert.equal(shown.state, "refusal");
  assert.equal(shown.actorRequired, false);
  assert.equal(shown.title, TASK_ACTIONS_TEXT.refusalTitle);
  assert.equal(shown.hint, null);
});

// --- refusals reach the page unchanged --------------------------------------------------

test("each action's refusal is the refusal state, branchling's text unchanged, and nothing is written", async () => {
  const fx = await fixture();
  const { server, post } = await serve(fx);
  try {
    const held = await stateOf(fx, "TASK-2");
    assert.equal(held.owner, OTHER_ACTOR);
    const cases = [
      ["take", { id: "TASK-2" }, () => fx.adapter.take("TASK-2"), "other-owner"],
      ["take", { id: "TASK-3" }, () => fx.adapter.take("TASK-3"), "closed"],
      ["release", { id: "TASK-2", reason: "Not mine." }, () => fx.adapter.release("TASK-2", { reason: "Not mine." }), "other-owner"],
      ["handoff", { id: "TASK-2", role: ROLES[0], reason: "Not mine." }, () => fx.adapter.handoff("TASK-2", { role: ROLES[0], reason: "Not mine." }), "other-owner"],
    ];
    for (const [action, value, direct, kind] of cases) {
      let err;
      await assert.rejects(direct(), e => { err = e; return e instanceof BranchlingRefusal; });
      const res = await post(action, value);
      assert.equal(res.status, 409, `${action} ${value.id}`);
      assert.equal(res.json.error.type, "refusal");
      assert.equal(res.json.error.refusalKind, kind);
      assert.equal(res.json.error.message, err.message, "branchling's text, unchanged");
      const shown = taskActionFailure(action, res.json, res.status);
      assert.equal(shown.state, "refusal");
      assert.equal(shown.detail, err.message);
      assert.deepEqual(shown.details, err.envelope.details);
      assert.equal(shown.refusalKindText, `${TASK_ACTIONS_TEXT.reasonCode}: ${kind}`);
      assert.equal(shown.nothingWritten, TASK_ACTIONS_TEXT.nothingWritten);
    }
    assert.deepEqual(await stateOf(fx, "TASK-2"), held, "nothing was written to TASK-2");
    assert.equal((await stateOf(fx, "TASK-3")).status, "done");
  } finally {
    await server.close();
  }
});

test("a role branchling does not know is the rejected state with the declared roles and its message verbatim, and nothing is handed off", async () => {
  const fx = await fixture();
  const { server, post } = await serve(fx);
  try {
    const res = await post("handoff", { id: "TASK-1", role: "designer", reason: "Needs a mockup." });
    assert.equal(res.status, 422, res.text);
    assert.equal(res.json.error.type, "rejected-input");
    assert.deepEqual(res.json.error.input, { role: "designer" });
    assert.deepEqual(res.json.error.declared, { role: ROLES }, "the vocabulary names the declared roles");
    assert.match(res.json.error.detail, /designer/);
    for (const role of ROLES) assert.ok(res.json.error.detail.includes(role), "branchling's own message names the declared roles");
    const shown = taskActionFailure("handoff", res.json, res.status);
    assert.equal(shown.state, "rejected");
    assert.equal(shown.title, "No role named “designer” is declared");
    assert.equal(shown.branchlingSaid, res.json.error.detail);
    assert.match(shown.detail, /nothing was handed off/);
    assert.deepEqual(await stateOf(fx, "TASK-1"), { status: "pending", owner: "unassigned", role: "" }, "TASK-1 is unchanged");
    // Positive control: a declared role hands it off.
    const ok = await post("handoff", { id: "TASK-1", role: ROLES[0], reason: "Needs code." });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await stateOf(fx, "TASK-1")).role, ROLES[0]);
  } finally {
    await server.close();
  }
});

test("without vocabulary a rejected role's declared list stays null, never empty", async () => {
  const fx = await fixture();
  // adapter.vocabulary() resolves null for an executable without the command
  // (branchling 0.3.0; test/adapter.test.mjs proves that mapping).
  const { server, post } = await serve(fx, { ...fx.adapter, vocabulary: async () => null });
  try {
    const res = await post("handoff", { id: "TASK-1", role: "designer", reason: "Needs a mockup." });
    assert.equal(res.status, 422, res.text);
    assert.deepEqual(res.json.error.declared, { role: null });
    const shown = taskActionFailure("handoff", res.json, res.status);
    assert.equal(shown.state, "rejected");
    assert.equal(shown.names[0].known, false);
  } finally {
    await server.close();
  }
});

// --- the write guard ---------------------------------------------------------------------

test("an action from a foreign origin or host, or without the token, is 403 and changes nothing", async () => {
  const fx = await fixture();
  const { server, token, post } = await serve(fx);
  try {
    const refused = [
      ["no token", { [CAPABILITY_HEADER]: "" }],
      ["wrong token", { [CAPABILITY_HEADER]: "x".repeat(token.length) }],
      ["foreign origin", { origin: "http://evil.example" }],
      ["no origin", { origin: "" }],
      ["foreign host", { host: `evil.example:${server.port}`, origin: `http://evil.example:${server.port}` }],
    ];
    for (const [name, headers] of refused) {
      for (const [action, value] of [["take", { id: "TASK-1" }], ["release", { id: "TASK-2", reason: "x" }], ["handoff", { id: "TASK-1", role: ROLES[0], reason: "x" }]]) {
        const res = await post(action, value, headers);
        assert.equal(res.status, 403, `${name} ${action}`);
        assert.equal(res.json.error.type, "forbidden", `${name} ${action}`);
      }
    }
    assert.deepEqual(await stateOf(fx, "TASK-1"), { status: "pending", owner: "unassigned", role: "" }, "nothing was taken or handed off");
    assert.equal((await stateOf(fx, "TASK-2")).owner, OTHER_ACTOR, "nothing was released");
    // Positive control: the same take with the right headers is written.
    const ok = await post("take", { id: "TASK-1" });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await stateOf(fx, "TASK-1")).owner, ACTOR);
  } finally {
    await server.close();
  }
});

test("a GET on an action route is not a way in", async () => {
  const fx = await fixture();
  const { server } = await serve(fx);
  try {
    const res = await call(server, { path: "/api/task/take?id=TASK-1" });
    assert.equal(res.status, 404, "the server routes by method and path: there is no GET route here");
    assert.equal((await stateOf(fx, "TASK-1")).owner, "unassigned");
  } finally {
    await server.close();
  }
});

// --- malformed requests ----------------------------------------------------------------

test("a malformed action is a 400 before branchling runs: no actor, no take-over, no flag-shaped value", async () => {
  const fx = await fixture();
  const spawned = [];
  const watching = { ...fx.adapter };
  for (const name of ["take", "release", "handoff"]) watching[name] = (...args) => { spawned.push(name); return fx.adapter[name](...args); };
  const { server, post } = await serve(fx, watching);
  try {
    const cases = [
      ["take", { id: "TASK-1", actor: "user:mallory" }, /actor is not taken from the page/],
      ["take", { id: "TASK-2", "take-over": true }, /Unknown field "take-over"/],
      ["take", { id: "TASK-1", probe: true }, /Unknown field "probe"/],
      ["take", { id: "TASK-1", reason: "x" }, /Unknown field "reason"/],
      ["take", { id: "--take-over" }, /not a task id/],
      ["take", { id: "TASK-1 --take-over" }, /not a task id/],
      ["take", {}, /not a task id/],
      ["take", [1], /JSON object/],
      ["release", { id: "TASK-2" }, /requires a reason/],
      ["release", { id: "TASK-2", reason: "   " }, /requires a reason/],
      ["release", { id: "TASK-2", reason: "--take-over" }, /cannot start with "-"/],
      ["release", { id: "TASK-2", reason: "x", status: "pending" }, /Unknown field "status"/],
      ["release", { id: "TASK-2", reason: "a".repeat(ACTION_LIMITS.reason + 1) }, /longer than 2000/],
      ["handoff", { id: "TASK-1", role: ROLES[0] }, /needs a reason/],
      ["handoff", { id: "TASK-1", reason: "x" }, /role is required/],
      ["handoff", { id: "TASK-1", role: "--to-owner", reason: "x" }, /cannot start with "-"/],
      ["handoff", { id: "TASK-1", role: "dev ops", reason: "x" }, /one word/],
      ["handoff", { id: "TASK-1", role: ROLES[0], reason: "x", "to-owner": "local:bo" }, /Unknown field "to-owner"/],
      ["handoff", { id: "TASK-1", role: ROLES[0], reason: "x", with: ["a.md"] }, /Unknown field "with"/],
      ["handoff", { id: "TASK-1", role: ROLES[0], reason: "x", actor: "local:bo" }, /actor is not taken/],
      ["handoff", { id: "TASK-1", role: ROLES[0], reason: "line\u0007bell" }, /control characters/],
    ];
    for (const [action, value, message] of cases) {
      const res = await post(action, value);
      assert.equal(res.status, 400, `${action} ${JSON.stringify(value).slice(0, 60)}`);
      assert.equal(res.json.error.type, "bad-request");
      assert.match(res.json.error.message, message, `${action} ${JSON.stringify(value).slice(0, 60)}`);
    }
    const notJson = await post("take", "{nope");
    assert.equal(notJson.status, 400);
    const wrongType = await post("take", JSON.stringify({ id: "TASK-1" }), { "content-type": "text/plain" });
    assert.equal(wrongType.status, 415);
    const huge = await post("release", JSON.stringify({ id: "TASK-2", reason: "a".repeat(MAX_BODY_BYTES) }));
    assert.equal(huge.status, 413);
    assert.deepEqual(spawned, [], "branchling was never asked");
    // Positive control: a well-formed take does reach it.
    assert.equal((await post("take", { id: "TASK-1" })).status, 200);
    assert.deepEqual(spawned, ["take"]);
  } finally {
    await server.close();
  }
});

// --- the view model, without a server --------------------------------------------------

test("validateTaskAction accepts exactly each action's fields, trimmed, and never an actor", () => {
  assert.deepEqual(validateTaskAction("take", { id: "TASK-1" }), { ok: true, value: { id: "TASK-1" } });
  assert.deepEqual(validateTaskAction("release", { id: "TASK-1", reason: " why " }), { ok: true, value: { id: "TASK-1", reason: "why" } });
  assert.deepEqual(validateTaskAction("handoff", { id: "TASK-1", role: " reviewer ", reason: "why" }), { ok: true, value: { id: "TASK-1", role: "reviewer", reason: "why" } });
  assert.equal(validateTaskAction("done", { id: "TASK-1" }).ok, false, "done is not an action of this task");
  assert.equal(validateTaskAction("handoff", { id: "TASK-1", role: "reviewer" }).field, "reason");
  assert.equal(validateTaskAction("handoff", { id: "TASK-1", reason: "x" }).field, "role");
  assert.equal(validateTaskAction("take", { id: "x", actor: "a" }).ok, false);
});

test("the command a dialog names is branchling's, never with --actor and always with --require-actor", () => {
  assert.equal(actionCommand("take", "TASK-1").text, "branchling take TASK-1 --require-actor");
  assert.equal(actionCommand("release", "TASK-1").text, "branchling release TASK-1 --reason \"…\" --require-actor");
  assert.equal(actionCommand("handoff", "TASK-1", { role: "reviewer" }).text, "branchling handoff TASK-1 --to-role reviewer --reason \"…\" --require-actor");
  assert.equal(actionCommand("handoff", "TASK-1").text, "branchling handoff TASK-1 --to-role <role> --reason \"…\" --require-actor");
  for (const action of ["take", "release", "handoff"]) assert.doesNotMatch(actionCommand(action, "TASK-1").text, /--actor|--take-over/);
  assert.equal(actionPath("take"), "/api/task/take");
});

test("the page serves the actions' view model and the panel draws them", async () => {
  const fx = await fixture();
  const { server } = await serve(fx);
  try {
    const model = await call(server, { path: "/view-model/task-actions.mjs" });
    assert.equal(model.status, 200);
    assert.match(model.headers["content-type"], /javascript/);
    const page = await call(server, { path: "/task.mjs" });
    assert.equal(page.status, 200);
    assert.match(page.text, /\/view-model\/task-actions\.mjs/);
    assert.match(page.text, /X-Branchling-UI-Capability/);
    const source = readFileSync(new URL("../src/web/task.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(source, /innerHTML/, "text goes in through textContent only");
  } finally {
    await server.close();
  }
});
