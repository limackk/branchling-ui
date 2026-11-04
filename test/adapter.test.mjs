/**
 * Contract tests: the adapter against the REAL branchling executable
 * (`BRANCHLING_BIN`, else `branchling` on PATH) over a fixture backlog built by
 * that executable in a temporary directory. Nothing here reads this
 * repository's own backlog, whose contents are data, not the contract.
 */

import "./fixtures/private-homes.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAdapter, run, quoteWindowsArg, cmdLineForBatch, VERDICT_KINDS,
  BranchlingRefusal, BranchlingUsageError, ContractMismatch,
} from "../src/adapter.mjs";
import { BROKEN_GUARDS, buildBrokenBacklog, buildHealthyBacklog } from "./fixtures/health-backlog.mjs";
import { OTHER_ACTOR, ROLES, buildActionsBacklog } from "./fixtures/actions-backlog.mjs";
import { fixtureEnv } from "./fixtures/env.mjs";
import { PRIORITIES, STATUSES, buildVocabularyBacklog } from "./fixtures/vocabulary-backlog.mjs";
import { priorityRole, statusRole, vocabularyRoles } from "../src/view-model/roles.mjs";

const BIN = process.env.BRANCHLING_BIN || "branchling";
let root;
let dir;

/** The fixture is built through the adapter's own spawn, so it starts
 *  branchling exactly as the adapter does, `.cmd` shim on Windows included. */
async function branchling(args, opts) {
  const { code, stderr } = await run(BIN, args, { cwd: root, env: fixtureEnv(root), ...opts });
  assert.equal(code, 0, `branchling ${args.join(" ")} exited ${code}: ${stderr}`);
}

before(async () => {
  root = mkdtempSync(join(tmpdir(), "branchling-ui-"));
  dir = join(root, "backlog");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  await branchling(["init", "--dir", dir, "--no-example", "--no-nudge"]);
  const body = JSON.stringify({
    goal: "A fixture task exists.",
    verification: [{ id: "noop", bash: "true", proves: "The fixture can be closed." }],
  });
  await branchling(["new", "--title", "Fixture task", "--priority", "P1", "--dir", dir], { input: body });
});

after(() => rmSync(root, { recursive: true, force: true }));

test("the installed executable is inside the supported range", async () => {
  const { version, supported } = await createAdapter({ bin: BIN }).version();
  assert.ok(supported, `branchling ${version} is outside the supported range`);
});

test("only 0.3.x is supported: 0.2.x has no show or deploy, 0.4.0 is untested", async () => {
  // A fake that prints `branchling <v>` for --version, as the real one does.
  const fakeVersion = v => {
    const file = join(root, process.platform === "win32" ? `fake-version-${v}.cmd` : `fake-version-${v}`);
    if (process.platform === "win32") writeFileSync(file, `@echo branchling ${v}\r\n`);
    else writeFileSync(file, `#!/bin/sh\necho 'branchling ${v}'\n`);
    chmodSync(file, 0o755);
    return file;
  };
  const cases = { "0.1.4": false, "0.2.0": false, "0.2.9": false, "0.3.0": true, "0.3.7": true, "0.4.0": false };
  for (const [v, expected] of Object.entries(cases)) {
    const answer = await createAdapter({ bin: fakeVersion(v) }).version();
    assert.deepEqual(answer, { version: v, supported: expected }, `branchling ${v}`);
  }
});

test("query returns the fixture task in a task-list envelope", async () => {
  const envelope = await createAdapter({ bin: BIN, dir, cwd: root }).query({ status: "pending" });
  assert.equal(envelope.kind, "task-list");
  assert.equal(envelope.tasks.length, 1);
  assert.equal(envelope.tasks[0].title, "Fixture task");
});

test("a filter that matches nothing is an empty list, not an error", async () => {
  // Positive control for the test above: the same call can return zero rows.
  const envelope = await createAdapter({ bin: BIN, dir, cwd: root }).query({ status: "done" });
  assert.deepEqual(envelope.tasks, []);
});

test("stats and plan answer with their declared kinds", async () => {
  const adapter = createAdapter({ bin: BIN, dir, cwd: root });
  assert.equal((await adapter.stats()).kind, "stats");
  assert.equal((await adapter.plan()).kind, "plan");
});

// `where` (UI-38): the backlog root the entries hand to the cache. A
// BACKLOG_DIR exported by the person running the tests would win over
// discovery, so these calls drop it.
const noBacklogEnv = { BACKLOG_DIR: null };

test("where names the fixture's backlog, and the rule that found it", async () => {
  const explicit = await createAdapter({ bin: BIN, dir, cwd: root, env: noBacklogEnv }).where();
  assert.equal(explicit.kind, "where");
  assert.equal(explicit.error, null);
  assert.equal(explicit.backlog.source, "explicit");
  assert.equal(realpathSync(explicit.backlog.root), realpathSync(dir));
  for (const key of ["home", "config", "data", "preferences", "agentProfiles"]) assert.ok(key in explicit, key);

  // Without --dir, branchling discovers it from the working directory, also below it.
  const sub = join(root, "nested", "deeper");
  mkdirSync(sub, { recursive: true });
  for (const cwd of [root, sub]) {
    const found = await createAdapter({ bin: BIN, cwd, env: noBacklogEnv }).where();
    assert.equal(found.backlog.source, "discovery", cwd);
    assert.equal(realpathSync(found.backlog.root), realpathSync(dir), cwd);
  }
});

test("where with no backlog is an answer (backlog null, the reason in error), not a refusal", async () => {
  const outside = mkdtempSync(join(tmpdir(), "branchling-ui-no-backlog-"));
  try {
    const none = await createAdapter({ bin: BIN, cwd: outside, env: noBacklogEnv }).where();
    assert.equal(none.kind, "where");
    assert.equal(none.backlog, null);
    assert.match(none.error, /no backlog/i);

    // A --dir that is not a backlog answers the same way.
    const notOne = await createAdapter({ bin: BIN, dir: join(root, "no-such-backlog"), cwd: root, env: noBacklogEnv }).where();
    assert.equal(notOne.backlog, null);
    assert.match(notOne.error, /does not look like a backlog/);

    // Positive control: the same call from the fixture finds one.
    assert.ok((await createAdapter({ bin: BIN, cwd: root, env: noBacklogEnv }).where()).backlog.root);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a where envelope with an unknown backlog shape is a contract mismatch", async () => {
  const base = { schemaVersion: 1, kind: "where", home: "/h", homeSource: "default", config: "/c", data: "/d" };
  const good = fakeBin("fake-where-ok", JSON.stringify({ ...base, backlog: { root: "/r/backlog", source: "explicit" }, error: null }), 0);
  assert.equal((await createAdapter({ bin: good }).where()).backlog.root, "/r/backlog");
  const noRoot = fakeBin("fake-where-no-root", JSON.stringify({ ...base, backlog: { source: "explicit" }, error: null }), 0);
  await assert.rejects(createAdapter({ bin: noRoot }).where(), ContractMismatch);
  const silent = fakeBin("fake-where-silent", JSON.stringify({ ...base, backlog: null, error: null }), 0);
  await assert.rejects(createAdapter({ bin: silent }).where(), ContractMismatch);
  // The 0.2.x shape: no schemaVersion, no kind.
  const bare = fakeBin("fake-where-02", JSON.stringify({ backlog: { root: "/r/backlog", source: "explicit" } }), 0);
  await assert.rejects(createAdapter({ bin: bare }).where(), ContractMismatch);
  const otherKind = fakeBin("fake-where-stats", JSON.stringify({ schemaVersion: 1, kind: "stats", root: "/r/backlog" }), 0);
  await assert.rejects(createAdapter({ bin: otherKind }).where(), ContractMismatch);
});

test("a value outside the vocabulary is a usage error, not an envelope", async () => {
  await assert.rejects(
    createAdapter({ bin: BIN, dir, cwd: root }).query({ status: "no-such-status" }),
    BranchlingUsageError,
  );
});

test("an unknown task id is a refusal carrying its envelope", async () => {
  await assert.rejects(
    createAdapter({ bin: BIN, dir, cwd: root }).show("TASK-999999"),
    err => err instanceof BranchlingRefusal && err.envelope.kind === "task-show",
  );
});

test("an unsupported schemaVersion is refused, not interpreted", async () => {
  const envelope = '{"schemaVersion": 99, "kind": "stats"}';
  const fake = join(root, process.platform === "win32" ? "fake-branchling.cmd" : "fake-branchling");
  if (process.platform === "win32") writeFileSync(fake, `@echo ${envelope}\r\n`);
  else writeFileSync(fake, `#!/bin/sh\necho '${envelope}'\n`);
  chmodSync(fake, 0o755);
  await assert.rejects(createAdapter({ bin: fake }).stats(), ContractMismatch);
});

test("shell metacharacters in an argument reach branchling as text", async () => {
  // On Windows the argument passes through cmd.exe; unescaped, `&` would end
  // the command there and start the next one. The filter must match nothing
  // and the call must still answer with a task-list.
  const hostile = 'x" & echo injected & "%PATH%^|<>()!';
  const envelope = await createAdapter({ bin: BIN, dir, cwd: root }).query({ text: hostile });
  assert.equal(envelope.kind, "task-list");
  assert.deepEqual(envelope.tasks, []);
});

test("the same call with a plain value finds the fixture", async () => {
  // Positive control for the test above: `text` filters by title at all.
  const envelope = await createAdapter({ bin: BIN, dir, cwd: root }).query({ text: "Fixture" });
  assert.equal(envelope.tasks.length, 1);
});

test("an argument is quoted the way the C runtime splits it back", () => {
  assert.equal(quoteWindowsArg("plain"), '"plain"');
  assert.equal(quoteWindowsArg("two words"), '"two words"');
  assert.equal(quoteWindowsArg('say "hi"'), '"say \\"hi\\""');
  assert.equal(quoteWindowsArg("C:\\dir\\"), '"C:\\dir\\\\"');
  assert.equal(quoteWindowsArg('a\\"b'), '"a\\\\\\"b"');
  assert.equal(quoteWindowsArg(""), '""');
});

test("every cmd.exe metacharacter in an argument is escaped twice", () => {
  const line = cmdLineForBatch("C:\\npm\\branchling.cmd", ["a&b"]);
  assert.equal(line, 'C:\\npm\\branchling.cmd ^^^"a^^^&b^^^"');
  // Nothing in the argument is left for cmd.exe to act on after two passes.
  assert.doesNotMatch(line.split(" ")[1], /(?<!\^)[&|<>]/);
});

/* ---------- doctor and check: verdicts, not refusals (UI-28) ---------- */

let healthy;
let broken;

before(async () => {
  [healthy, broken] = await Promise.all([
    buildHealthyBacklog(join(root, "healthy")),
    buildBrokenBacklog(join(root, "broken")),
  ]);
});

const on = fixture => createAdapter({ bin: BIN, dir: fixture.dir, cwd: fixture.root });

/** A fake branchling that prints `envelope` and exits with `code`, whatever it is asked. */
function fakeBin(name, envelope, code) {
  const file = join(root, process.platform === "win32" ? `${name}.cmd` : name);
  if (process.platform === "win32") writeFileSync(file, `@echo ${envelope}\r\n@exit /b ${code}\r\n`);
  else writeFileSync(file, `#!/bin/sh\necho '${envelope}'\nexit ${code}\n`);
  chmodSync(file, 0o755);
  return file;
}

test("doctor and check pass on a healthy backlog, exit 0, with the keys the view reads", async () => {
  const doctor = await on(healthy).doctor();
  assert.equal(doctor.kind, "doctor");
  assert.equal(doctor.ok, true);
  assert.equal(typeof doctor.root, "string");
  assert.equal(typeof doctor.next, "string");
  assert.ok(doctor.checks.length > 0);
  for (const key of ["id", "title", "status", "detail", "fix"]) assert.ok(key in doctor.checks[0], `a doctor check has ${key}`);
  assert.ok(!doctor.checks.some(c => c.status === "error"), "no setup check is an error");

  const check = await on(healthy).check();
  assert.equal(check.kind, "check");
  assert.equal(check.ok, true);
  assert.deepEqual(check.failed, []);
  for (const key of ["name", "severity", "ok", "exit", "output"]) assert.ok(key in check.guards[0], `a guard has ${key}`);
  // Guards that judge branchling's own source are not run on another backlog.
  assert.ok(check.guards.some(g => g.skipped === true), "some guard is reported as not run");
});

test("a broken backlog's failing doctor is returned as data, not thrown", async () => {
  // branchling exits 1 here with a normal envelope; json() would call that a refusal.
  const { code } = await run(BIN, ["doctor", "--dir", broken.dir, "--json"], { cwd: broken.root });
  assert.equal(code, 1, "positive control: the real exit is non-zero");
  const doctor = await on(broken).doctor();
  assert.equal(doctor.ok, false);
  assert.equal(doctor.refusalKind, undefined);
  assert.equal(doctor.checks.find(c => c.id === "vocabulary").status, "error");
});

test("a broken backlog's failing check is returned with the failed guards named", async () => {
  const { code } = await run(BIN, ["check", "--dir", broken.dir, "--json"], { cwd: broken.root });
  assert.equal(code, 1, "positive control: the real exit is non-zero");
  const check = await on(broken).check();
  assert.equal(check.ok, false);
  assert.deepEqual(check.failed, BROKEN_GUARDS);
  for (const name of BROKEN_GUARDS) assert.equal(check.guards.find(g => g.name === name).ok, false, name);
  assert.equal(check.guards.find(g => g.name === "id-collisions").ok, true, "positive control: an unbroken guard passes");
});

test("doctor where there is no backlog is a failing verdict naming it, not an error", async () => {
  const doctor = await createAdapter({ bin: BIN, dir: join(root, "no-such-backlog"), cwd: root }).doctor();
  assert.equal(doctor.ok, false);
  assert.equal(doctor.root, null);
  assert.deepEqual(doctor.checks.map(c => [c.id, c.status]), [["backlog", "error"]]);
});

test("check where there is no backlog is a failing verdict naming it, as doctor's is", async () => {
  // Since branchling TL-541; before it stdout was empty and this rejected
  // with BranchlingUsageError (UI-34).
  const check = await createAdapter({ bin: BIN, dir: join(root, "no-such-backlog"), cwd: root }).check();
  assert.equal(check.ok, false);
  assert.equal(check.root, null);
  assert.deepEqual(check.failed, ["backlog"]);
  assert.deepEqual(check.guards.map(g => [g.name, g.ok]), [["backlog", false]]);
  // Positive control: the same call on a backlog finds its root.
  assert.ok((await on(healthy).check()).root);
});

test("only doctor and check may answer a non-zero exit with data", async () => {
  assert.deepEqual(Object.keys(VERDICT_KINDS).sort(), ["check", "doctor"]);
  // Every other call keeps the rule: a non-zero exit is a refusal.
  const stats = fakeBin("fake-stats-exit-1", '{"schemaVersion": 1, "kind": "stats", "ok": false}', 1);
  await assert.rejects(createAdapter({ bin: stats }).stats(), BranchlingRefusal);
});

test("a verdict whose ok disagrees with its exit code is a contract mismatch", async () => {
  const okButFailed = fakeBin("fake-check-ok-exit-1", '{"schemaVersion": 1, "kind": "check", "ok": true, "failed": [], "guards": []}', 1);
  await assert.rejects(createAdapter({ bin: okButFailed }).check(), ContractMismatch);
  const failedButZero = fakeBin("fake-doctor-fail-exit-0", '{"schemaVersion": 1, "kind": "doctor", "ok": false, "checks": []}', 0);
  await assert.rejects(createAdapter({ bin: failedButZero }).doctor(), ContractMismatch);
  const noneNamed = fakeBin("fake-check-fail-unnamed", '{"schemaVersion": 1, "kind": "check", "ok": false, "failed": [], "guards": []}', 1);
  await assert.rejects(createAdapter({ bin: noneNamed }).check(), ContractMismatch);
  // Positive control: the agreeing shape is accepted from the same kind of fake.
  const agreeing = fakeBin("fake-check-fail-named", '{"schemaVersion": 1, "kind": "check", "ok": false, "failed": ["refs"], "guards": []}', 1);
  assert.deepEqual((await createAdapter({ bin: agreeing }).check()).failed, ["refs"]);
});

test("a doctor or check refusal still throws", async () => {
  const refused = fakeBin("fake-check-refusal", '{"schemaVersion": 1, "kind": "check", "ok": false, "failed": ["refs"], "guards": [], "refusalKind": "no-backlog", "refusal": "no"}', 1);
  await assert.rejects(createAdapter({ bin: refused }).check(), err => err instanceof BranchlingRefusal && err.envelope.refusalKind === "no-backlog");
});

// --- take, release and handoff (UI-30) ----------------------------------------------
// Each builds its own fixture (test/fixtures/actions-backlog.mjs), whose
// branchling state, data and config homes are inside its own root, so the
// `take` locks never land in the user's state directory.

const ACTOR = "local:maja";

async function actionsFixture() {
  const fx = await buildActionsBacklog(join(root, `actions-${Math.random().toString(36).slice(2)}`), { bin: BIN });
  return { ...fx, adapter: createAdapter({ bin: BIN, dir: fx.dir, cwd: fx.root, env: { ...fx.env, BACKLOG_ACTOR: ACTOR } }) };
}

test("take reserves a task (task-take), and refuses one held by somebody else or closed", async () => {
  const { adapter } = await actionsFixture();
  const taken = await adapter.take("TASK-1");
  assert.equal(taken.kind, "task-take");
  assert.equal(taken.ok, true);
  assert.equal(taken.id, "TASK-1");
  assert.equal(taken.task.owner, ACTOR);
  assert.equal(taken.lock.actor, ACTOR);
  assert.equal(taken.from, "pending");
  assert.equal(typeof taken.task.status, "string");
  assert.notEqual(taken.task.status, taken.from);
  await assert.rejects(adapter.take("TASK-2"), err => err instanceof BranchlingRefusal
    && err.envelope.kind === "task-take" && err.envelope.refusalKind === "other-owner" && err.message.includes(OTHER_ACTOR));
  await assert.rejects(adapter.take("TASK-3"), err => err instanceof BranchlingRefusal && err.envelope.refusalKind === "closed");
  // An unknown task exits 2, but WITH an envelope: a refusal, not a usage error.
  await assert.rejects(adapter.take("TASK-99"), err => err instanceof BranchlingRefusal && err.envelope.refusalKind === "not-found" && err.code === 2);
});

test("release returns a held task to the queue (task-release), and refuses somebody else's", async () => {
  const { adapter } = await actionsFixture();
  await adapter.take("TASK-1");
  const released = await adapter.release("TASK-1", { reason: "Blocked on the payment provider." });
  assert.equal(released.kind, "task-release");
  assert.equal(released.ok, true);
  assert.equal(released.released, true);
  assert.equal(released.owner, "");
  assert.equal(typeof released.comment, "string");
  await assert.rejects(adapter.release("TASK-2", { reason: "Not mine." }), err => err instanceof BranchlingRefusal
    && err.envelope.kind === "task-release" && err.envelope.refusalKind === "other-owner");
  assert.equal((await adapter.show("TASK-2")).kind, "task-show", "positive control: the fixture still answers");
});

test("handoff hands a task to a declared role (task-handoff); an undeclared role is a usage error", async () => {
  const { adapter } = await actionsFixture();
  await adapter.take("TASK-1");
  const handed = await adapter.handoff("TASK-1", { role: ROLES[1], reason: "Ready for review." });
  assert.equal(handed.kind, "task-handoff");
  assert.equal(handed.ok, true);
  assert.deepEqual(handed.role, { from: "", to: ROLES[1] });
  assert.deepEqual(handed.owner, { from: ACTOR, to: "" });
  assert.equal(handed.comment.actor, ACTOR);
  assert.equal(handed.comment.text, "Ready for review.");
  await assert.rejects(adapter.handoff("TASK-2", { role: ROLES[0], reason: "Not mine." }), err => err instanceof BranchlingRefusal
    && err.envelope.kind === "task-handoff" && err.envelope.refusalKind === "other-owner");
  // branchling (0.2.0 and the pinned 0.3.0) rejects an undeclared role with stderr only, exit 2.
  await assert.rejects(adapter.handoff("TASK-4", { role: "designer", reason: "x" }), err => err instanceof BranchlingUsageError
    && err.code === 2 && /designer/.test(err.stderr));
});

test("a writing call refuses a missing or flag-shaped value before branchling runs", async () => {
  // A bin that does not exist: reaching the spawn would fail differently.
  const adapter = createAdapter({ bin: join(root, "no-such-branchling"), dir });
  const refused = [
    () => adapter.take("--take-over"),
    () => adapter.take(""),
    () => adapter.release("TASK-1", {}),
    () => adapter.release("TASK-1", { reason: "--actor=x" }),
    () => adapter.handoff("TASK-1", { role: "--to-owner", reason: "x" }),
    () => adapter.handoff("TASK-1", { role: "reviewer" }),
  ];
  for (const call of refused) await assert.rejects(call(), err => err instanceof BranchlingUsageError && /required|flag/.test(err.message));
  // Positive control: a well-formed call does reach the spawn (and fails there).
  await assert.rejects(adapter.take("TASK-1"), err => !(err instanceof BranchlingUsageError && /flag|required/.test(err.message)));
});

/* ---------- vocabulary: the backlog's own words (UI-18, upstream TL-532) ---------- */

let renamed;

before(async () => {
  renamed = await buildVocabularyBacklog(join(root, "renamed"));
});

test("vocabulary returns a non-default fixture's statuses and priorities, in declared order", async t => {
  const answer = await on(renamed).vocabulary();
  if (answer === null) {
    // branchling 0.3.0, the published floor of the range, predates the
    // command. Reported as a skip, never as a pass: nothing was proved.
    t.skip("the executable under test has no `vocabulary` command (TL-532 is not in this build)");
    return;
  }
  assert.equal(answer.kind, "vocabulary");
  assert.deepEqual(
    answer.statuses.map(({ name, archived, role, roleSource }) => ({ name, archived, role, roleSource })),
    STATUSES,
  );
  assert.deepEqual(answer.priorities, PRIORITIES);
  // The colours the views paint come from those roles and that order, not
  // from names: none of the default names is declared here.
  const roles = vocabularyRoles(answer);
  const painted = Object.fromEntries(STATUSES.map(s => [s.name, statusRole(s.name, roles)]));
  assert.deepEqual(painted, { todo: "neutral", doing: "progress", parked: "attention", review: "attention", shipped: "success", dropped: "muted" });
  assert.deepEqual(PRIORITIES.map(p => priorityRole(p, roles)), ["danger", "attention", "neutral", "muted"]);
  for (const name of ["pending", "in_progress", "done"]) assert.equal(statusRole(name, roles), "neutral", `${name} is not declared here`);
  assert.equal(priorityRole("P0", roles), "neutral");
  // Positive control: the default fixture's vocabulary is a different answer,
  // so the one above was read from this backlog and not from a default.
  const defaults = await createAdapter({ bin: BIN, dir, cwd: root }).vocabulary();
  assert.deepEqual(defaults.priorities, ["P0", "P1", "P2", "P3"]);
  assert.notDeepEqual(defaults.statuses.map(s => s.name), answer.statuses.map(s => s.name));
});

/** A fake branchling that prints `message` on stderr and exits 2, as an unknown command does. */
function fakeUsage(name, message) {
  const file = join(root, process.platform === "win32" ? `${name}.cmd` : name);
  if (process.platform === "win32") writeFileSync(file, `@echo ${message} 1>&2\r\n@exit /b 2\r\n`);
  else writeFileSync(file, `#!/bin/sh\necho '${message}' >&2\nexit 2\n`);
  chmodSync(file, 0o755);
  return file;
}

test("vocabulary from an executable without the command is null, not an error", async () => {
  const old = fakeUsage("fake-vocabulary-unknown", "x branchling: unknown command: vocabulary");
  assert.equal(await createAdapter({ bin: old }).vocabulary(), null);
  // Positive control: any OTHER usage error is still thrown, so null is not
  // what every failure becomes.
  const otherwise = fakeUsage("fake-vocabulary-flag", "x branchling: unknown flag: --json");
  await assert.rejects(createAdapter({ bin: otherwise }).vocabulary(), BranchlingUsageError);
});

test("a vocabulary envelope without status roles is a contract mismatch", async () => {
  const base = { schemaVersion: 1, kind: "vocabulary", root: "/r/backlog" };
  const good = fakeBin("fake-vocabulary-ok", JSON.stringify({ ...base, statuses: [{ name: "open", archived: false, role: "open" }], priorities: ["A"] }), 0);
  assert.equal((await createAdapter({ bin: good }).vocabulary()).statuses[0].name, "open");
  const noRole = fakeBin("fake-vocabulary-no-role", JSON.stringify({ ...base, statuses: [{ name: "open", archived: false }], priorities: ["A"] }), 0);
  await assert.rejects(createAdapter({ bin: noRole }).vocabulary(), ContractMismatch);
  const badPriority = fakeBin("fake-vocabulary-priority", JSON.stringify({ ...base, statuses: [], priorities: [1] }), 0);
  await assert.rejects(createAdapter({ bin: badPriority }).vocabulary(), ContractMismatch);
  const otherKind = fakeBin("fake-vocabulary-stats", JSON.stringify({ schemaVersion: 1, kind: "stats", root: "/r/backlog" }), 0);
  await assert.rejects(createAdapter({ bin: otherKind }).vocabulary(), ContractMismatch);
});
