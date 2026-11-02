/**
 * Contract tests: the adapter against the REAL branchling executable
 * (`BRANCHLING_BIN`, else `branchling` on PATH) over a fixture backlog built by
 * that executable in a temporary directory. Nothing here reads this
 * repository's own backlog, whose contents are data, not the contract.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAdapter, run, quoteWindowsArg, cmdLineForBatch,
  BranchlingRefusal, BranchlingUsageError, ContractMismatch,
} from "../src/adapter.mjs";

const BIN = process.env.BRANCHLING_BIN || "branchling";
let root;
let dir;

/** The fixture is built through the adapter's own spawn, so it starts
 *  branchling exactly as the adapter does, `.cmd` shim on Windows included. */
async function branchling(args, opts) {
  const { code, stderr } = await run(BIN, args, { cwd: root, ...opts });
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
