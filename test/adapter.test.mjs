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
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAdapter, run, quoteWindowsArg, cmdLineForBatch, VERDICT_KINDS,
  BranchlingRefusal, BranchlingUsageError, ContractMismatch,
} from "../src/adapter.mjs";
import { BROKEN_GUARDS, buildBrokenBacklog, buildHealthyBacklog } from "./fixtures/health-backlog.mjs";
import { fixtureEnv } from "./fixtures/env.mjs";

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

test("check where there is no backlog prints no envelope: a usage error (an upstream gap)", async () => {
  await assert.rejects(createAdapter({ bin: BIN, dir: join(root, "no-such-backlog"), cwd: root }).check(), BranchlingUsageError);
  // Positive control: the same call on a backlog answers.
  assert.equal((await on(healthy).check()).kind, "check");
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
