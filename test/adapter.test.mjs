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

import { createAdapter, BranchlingRefusal, BranchlingUsageError, ContractMismatch } from "../src/adapter.mjs";

const BIN = process.env.BRANCHLING_BIN || "branchling";
let root;
let dir;

before(() => {
  root = mkdtempSync(join(tmpdir(), "branchling-ui-"));
  dir = join(root, "backlog");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync(BIN, ["init", "--dir", dir, "--no-example", "--no-nudge"], { cwd: root });
  const body = JSON.stringify({
    goal: "A fixture task exists.",
    verification: [{ id: "noop", bash: "true", proves: "The fixture can be closed." }],
  });
  execFileSync(BIN, ["new", "--title", "Fixture task", "--priority", "P1", "--dir", dir], { cwd: root, input: body });
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
  const fake = join(root, "fake-branchling");
  writeFileSync(fake, '#!/bin/sh\necho \'{"schemaVersion": 99, "kind": "stats"}\'\n');
  chmodSync(fake, 0o755);
  await assert.rejects(createAdapter({ bin: fake }).stats(), ContractMismatch);
});
