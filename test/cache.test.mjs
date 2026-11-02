/**
 * The read cache (UI-2) against the REAL branchling executable over a fixture
 * backlog built by that executable in a temporary directory, as
 * test/adapter.test.mjs does. Spawns are counted at the spawn boundary: the
 * adapter is given a `bin` shim that appends a line to a counter file and then
 * starts the real executable, so a "hit" is proven by no process starting, not
 * by anything the cache says about itself.
 *
 * Most tests use a short racy window so they do not wait two seconds after
 * every edit; the acceptance test uses the defaults, RACY_MS included.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { createAdapter, run, BranchlingRefusal } from "../src/adapter.mjs";
import { createCache, createFileChanges, RACY_MS } from "../src/cache.mjs";

const BIN = process.env.BRANCHLING_BIN || "branchling";
const RACY = 400;
let root;
let dir;
let counterFile;
let countingBin;
let taskFile;
let shimDir;

async function branchling(args, opts) {
  const { code, stderr } = await run(BIN, args, { cwd: root, ...opts });
  assert.equal(code, 0, `branchling ${args.join(" ")} exited ${code}: ${stderr}`);
}

// A body `branchling body` accepts for the fixture task: its criterion links
// the fixture's `noop` verification entry.
function fixtureBody(goal) {
  return `\n## Goal\n\n${goal}\n\n## Acceptance criteria\n\n- [ ] ${goal} [proof: noop]\n`;
}

function gitIn(cwd, args) {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], { cwd, encoding: "utf8" });
}

const spawns = () => readFileSync(counterFile, "utf8").split("\n").filter(Boolean).length;
const settle = (ms = RACY) => sleep(ms + 150);
const adapter = () => createAdapter({ bin: countingBin, dir, cwd: root });
const cacheFor = a => createCache(a, { changes: createFileChanges({ dir, cwd: root, racyMs: RACY }) });

before(async () => {
  root = mkdtempSync(join(tmpdir(), "branchling-ui-cache-"));
  dir = join(root, "backlog");
  gitIn(root, ["init", "-q", "-b", "main"]);
  await branchling(["init", "--dir", dir, "--no-example", "--no-nudge"]);
  const body = JSON.stringify({
    goal: "A fixture task exists.",
    verification: [{ id: "noop", bash: "true", proves: "The fixture can be closed." }],
  });
  await branchling(["new", "--title", "Fixture task", "--priority", "P1", "--dir", dir], { input: body });
  gitIn(root, ["add", "-A"]);
  gitIn(root, ["commit", "-q", "-m", "fixture"]);
  taskFile = join(dir, JSON.parse((await run(BIN, ["show", "TASK-1", "--json", "--dir", dir], { cwd: root })).stdout).file);

  // The counter sits outside the backlog and outside the repository's
  // tracked tree, so counting can never itself invalidate the cache.
  shimDir = mkdtempSync(join(tmpdir(), "branchling-ui-shim-"));
  counterFile = join(shimDir, "spawns");
  writeFileSync(counterFile, "");
  if (process.platform === "win32") {
    countingBin = join(shimDir, "counting-branchling.cmd");
    writeFileSync(countingBin, `@echo spawn>>"${counterFile}"\r\n@call "${BIN}" %*\r\n`);
  } else {
    countingBin = join(shimDir, "counting-branchling");
    writeFileSync(countingBin, `#!/bin/sh\necho spawn >> '${counterFile}'\nexec '${BIN}' "$@"\n`);
    chmodSync(countingBin, 0o755);
  }
});

after(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(shimDir, { recursive: true, force: true });
});

test("the counting shim counts each real spawn", async () => {
  // Positive control for every "spawned nothing" below.
  const n = spawns();
  const envelope = await adapter().stats();
  assert.equal(envelope.kind, "stats");
  assert.equal(spawns(), n + 1);
});

test("two identical reads spawn once; an edit through branchling makes the next read spawn and return it", async () => {
  // The acceptance criterion, with the defaults: no injected source, RACY_MS.
  const cache = createCache(adapter(), { dir, cwd: root });
  await settle(RACY_MS);
  const n = spawns();
  const first = await cache.query({ text: "Fixture" });
  const second = await cache.query({ text: "Fixture" });
  assert.equal(spawns(), n + 1);
  assert.equal(first.fromCache, false);
  assert.equal(second.fromCache, true);
  assert.equal(second.envelope, first.envelope);
  assert.equal(first.envelope.tasks[0].status, "pending");

  // `take`, not `set`: the pinned branchling has no `set` yet (UI-6).
  await branchling(["take", "TASK-1", "--actor", "local:test", "--dir", dir]);
  // Past the racy window, so the miss below comes from the fingerprint.
  await settle(RACY_MS);
  const third = await cache.query({ text: "Fixture" });
  assert.equal(spawns(), n + 2);
  assert.equal(third.fromCache, false);
  assert.equal(third.envelope.tasks[0].status, "in_progress");
});

test("a same-size hand edit with its mtime restored still invalidates", async () => {
  // The granularity stress case: path, size, inode and mtime all unchanged;
  // only ctime, which user space cannot set back, records the write.
  // utimes cannot restore nanoseconds, so pin the mtime to a whole second
  // first; restoring that value later is then exact to the nanosecond.
  const pinned = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
  utimesSync(taskFile, pinned, pinned);
  const cache = cacheFor(adapter());
  await settle();
  const n = spawns();
  const before = await cache.query({ text: "Fixture" });
  assert.equal((await cache.query({ text: "Fixture" })).fromCache, true);
  assert.equal(spawns(), n + 1);
  const from = before.envelope.tasks[0].priority;
  const to = from === "P3" ? "P0" : "P3";

  const st = statSync(taskFile, { bigint: true });
  const text = readFileSync(taskFile, "utf8");
  assert.match(text, new RegExp(`^priority: ${from}$`, "m"));
  writeFileSync(taskFile, text.replace(new RegExp(`^priority: ${from}$`, "m"), `priority: ${to}`));
  utimesSync(taskFile, pinned, pinned);
  const after = statSync(taskFile, { bigint: true });
  assert.equal(after.size, st.size);
  assert.equal(after.ino, st.ino);
  assert.equal(after.mtimeNs, st.mtimeNs);
  assert.notEqual(after.ctimeNs, st.ctimeNs);

  await settle();
  const fresh = await cache.query({ text: "Fixture" });
  assert.equal(spawns(), n + 2);
  assert.equal(fresh.fromCache, false);
  assert.equal(fresh.envelope.tasks[0].priority, to);
});

test("a read right after a write is not served or stored from a racy fingerprint", async () => {
  // The source's clock is injected and frozen at the moment the write
  // finished: branchling may write its file early and run on for longer than
  // any window under load, so racing the real clock would be a flaky test.
  await branchling(["body", "TASK-1", "--reason", "racy test", "--actor", "local:test", "--dir", dir], { input: fixtureBody("Racy test.") });
  let clock = Date.now();
  const cache = createCache(adapter(), { changes: createFileChanges({ dir, cwd: root, now: () => clock }) });
  const n = spawns();
  const a = await cache.show("TASK-1");
  const b = await cache.show("TASK-1");
  assert.equal(spawns(), n + 2);
  assert.equal(b.fromCache, false);
  // Positive control: once the window has passed, the same reads do hit.
  clock += RACY_MS + 1;
  await cache.show("TASK-1");
  assert.equal((await cache.show("TASK-1")).fromCache, true);
  assert.equal(spawns(), n + 3);
  assert.equal(a.envelope.kind, "task-show");
});

test("a commit, which moves HEAD, invalidates", async () => {
  const cache = cacheFor(adapter());
  await settle();
  const n = spawns();
  await cache.stats();
  assert.equal((await cache.stats()).fromCache, true);
  assert.equal(spawns(), n + 1);
  gitIn(root, ["commit", "-q", "--allow-empty", "-m", "move HEAD"]);
  assert.equal((await cache.stats()).fromCache, false);
  assert.equal(spawns(), n + 2);
});

test("an uncommitted edit in a sibling worktree invalidates", async () => {
  // `show` reports a sibling worktree's status as `elsewhere`, so its backlog
  // directory is part of the fingerprint.
  gitIn(root, ["add", "-A"]);
  gitIn(root, ["commit", "-q", "-m", "edits so far"]);
  const sibling = join(root, "..", root.split(/[\\/]/).pop() + "-sibling");
  gitIn(root, ["worktree", "add", "-q", sibling, "-b", "sibling"]);
  try {
    const cache = cacheFor(adapter());
    await settle();
    const n = spawns();
    await cache.show("TASK-1");
    assert.equal((await cache.show("TASK-1")).fromCache, true);
    await run(BIN, ["body", "TASK-1", "--reason", "sibling", "--actor", "local:test", "--dir", join(sibling, "backlog")], { cwd: sibling, input: fixtureBody("Sibling edit.") });
    assert.match(gitIn(sibling, ["status", "--porcelain"]), /backlog\/tasks\//);
    await settle();
    assert.equal((await cache.show("TASK-1")).fromCache, false);
    assert.equal(spawns(), n + 2);
  } finally {
    gitIn(root, ["worktree", "remove", "--force", sibling]);
  }
});

test("different arguments are different keys", async () => {
  const cache = cacheFor(adapter());
  await settle();
  const n = spawns();
  // TASK-1 was taken by the first edit test, so it is the one in_progress task.
  const taken = await cache.query({ status: "in_progress" });
  const done = await cache.query({ status: "done" });
  assert.equal(spawns(), n + 2);
  assert.equal(taken.envelope.tasks.length, 1);
  assert.deepEqual(done.envelope.tasks, []);
  // Positive control: each key, asked again, is a hit with its own answer.
  assert.equal((await cache.query({ status: "in_progress" })).envelope, taken.envelope);
  assert.equal((await cache.query({ status: "done" })).envelope, done.envelope);
  assert.equal(spawns(), n + 2);
});

test("an error is not cached", async () => {
  const cache = cacheFor(adapter());
  await settle();
  const n = spawns();
  const refused = err => err instanceof BranchlingRefusal && err.envelope.kind === "task-show";
  await assert.rejects(cache.show("TASK-999999"), refused);
  await assert.rejects(cache.show("TASK-999999"), refused);
  assert.equal(spawns(), n + 2);
  // Positive control: the same method with a known id is cached.
  await cache.show("TASK-1");
  await cache.show("TASK-1");
  assert.equal(spawns(), n + 3);
});

test("the answer time is exposed and a hit carries the original one", async () => {
  const cache = cacheFor(adapter());
  await settle();
  const t0 = Date.now();
  const first = await cache.plan();
  const t1 = Date.now();
  assert.ok(first.answeredAt >= t0 && first.answeredAt <= t1);
  await sleep(30);
  const hit = await cache.plan();
  assert.equal(hit.fromCache, true);
  assert.ok(hit.answeredAt <= first.answeredAt, "a hit must not look fresher than its spawn");
  assert.equal(hit.answeredAt, first.answeredAt);
});

test("a caller cannot corrupt the cache by mutating an answer", async () => {
  const cache = cacheFor(adapter());
  await settle();
  const first = await cache.query({ text: "Fixture" });
  assert.throws(() => { first.envelope.tasks.push({ id: "TASK-0" }); }, TypeError);
  assert.throws(() => { first.envelope.tasks[0].title = "changed"; }, TypeError);
  assert.throws(() => { first.answeredAt = 0; }, TypeError);
  const hit = await cache.query({ text: "Fixture" });
  assert.equal(hit.fromCache, true);
  assert.equal(hit.envelope.tasks.length, 1);
  assert.equal(hit.envelope.tasks[0].title, "Fixture task");
});

test("identical reads in flight together share one spawn", async () => {
  const cache = cacheFor(adapter());
  await settle();
  const n = spawns();
  const [a, b] = await Promise.all([cache.stats(), cache.stats()]);
  assert.equal(spawns(), n + 1);
  assert.equal(a.envelope, b.envelope);
});

test("a write through the cache invalidates even when the fingerprint cannot see it", async () => {
  // A source that never changes: only the cache's own generation can miss.
  let generation = 0;
  const cache = createCache(adapter(), { changes: { token: async () => String(generation) } });
  const n = spawns();
  await cache.stats();
  assert.equal((await cache.stats()).fromCache, true);
  await cache.raw(["stats"], "stats");
  assert.equal((await cache.stats()).fromCache, false);
  // The injected seam (TL-524): a bumped token is a miss.
  generation++;
  assert.equal((await cache.stats()).fromCache, false);
  assert.equal((await cache.stats()).fromCache, true);
  assert.equal(spawns(), n + 4);
});

test("a backlog directory outside any git repository is fingerprinted without git", async () => {
  const plain = mkdtempSync(join(tmpdir(), "branchling-ui-nogit-"));
  try {
    mkdirSync(join(plain, "tasks"));
    writeFileSync(join(plain, "tasks", "a.md"), "one");
    const changes = createFileChanges({ dir: plain, racyMs: RACY });
    await settle();
    const t1 = await changes.token();
    assert.equal(typeof t1, "string");
    assert.equal(await changes.token(), t1);
    writeFileSync(join(plain, "tasks", "a.md"), "two");
    assert.equal(await changes.token(), null, "a fresh write is racy");
    await settle();
    const t2 = await changes.token();
    assert.equal(typeof t2, "string");
    assert.notEqual(t2, t1);
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }
});
