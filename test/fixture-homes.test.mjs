/**
 * The fixtures keep branchling's per-user directories to themselves (UI-32).
 *
 * `take` writes a reservation under branchling's STATE home, which defaults to
 * the user's own `~/.local/state/branchling`. A fixture that let it land there
 * left a lock behind that outlived it, so rebuilding a fixture at the same path
 * was refused with "TASK-2 is held by agent:fixture", and every test run on the
 * machine shared one directory.
 *
 * Measured with sentinels, never by reading the user's real directories: this
 * process points every variable branchling chooses its homes by at an empty
 * temporary directory, so anything a fixture failed to keep would land there.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOMES } from "./fixtures/env.mjs";
import { buildPlanBacklog } from "./fixtures/plan-backlog.mjs";
import { buildTasksBacklog } from "./fixtures/tasks-backlog.mjs";
import { buildBrokenBacklog } from "./fixtures/health-backlog.mjs";
import { buildTaskBacklog } from "./fixtures/task-backlog.mjs";
import { buildOverviewBacklog } from "./fixtures/overview-backlog.mjs";

const sentinel = mkdtempSync(join(tmpdir(), "branchling-ui-sentinel-"));
const work = mkdtempSync(join(tmpdir(), "branchling-ui-homes-"));

before(() => {
  // Each one a different directory, so a leak also says which rule it took.
  process.env.XDG_STATE_HOME = join(sentinel, "xdg-state");
  process.env.XDG_DATA_HOME = join(sentinel, "xdg-data");
  process.env.XDG_CONFIG_HOME = join(sentinel, "xdg-config");
  process.env.XDG_CACHE_HOME = join(sentinel, "xdg-cache");
  process.env.BACKLOG_STATE_DIR = join(sentinel, "state-dir");
  process.env.BRANCHLING_HOME = join(sentinel, "home");
});

after(() => {
  rmSync(sentinel, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

/** Every file under `root`, relative to it. */
function files(root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const name of readdirSync(root, { recursive: true })) {
    if (!statSync(join(root, name)).isDirectory()) out.push(name);
  }
  return out;
}

test("building the fixtures writes nothing into the homes the environment names", async () => {
  const tasks = await buildTasksBacklog(join(work, "tasks"));
  const [broken, task, overview] = await Promise.all([
    buildBrokenBacklog(join(work, "broken")),
    buildTaskBacklog(join(work, "task")),
    buildOverviewBacklog(join(work, "overview")),
  ]);
  assert.deepEqual(readdirSync(sentinel), [], "nothing was created in any sentinel home");

  // Positive control: every one of them ran `take`, and its lock directory
  // (with the `origin` file naming the repository) is in the fixture. The
  // lock itself may be gone again: `ask` releases it.
  for (const fx of [tasks, broken, task, overview]) {
    const origins = files(join(fx.root, HOMES, "state")).filter(f => f.endsWith("origin"));
    assert.ok(origins.length > 0, `${fx.root} keeps its own lock directory`);
    assert.doesNotMatch(execFileSync("git", ["status", "--porcelain"], { cwd: fx.root, encoding: "utf8" }), new RegExp(`^.. ${HOMES}/`, "m"),
      "the homes are not part of the fixture's repository");
  }
});

test("a fixture rebuilt at the path of a deleted one is not held by the old one's lock", async () => {
  const root = join(work, "same-path");
  await buildPlanBacklog(root);
  rmSync(root, { recursive: true, force: true });
  // The second build takes TASK-2 again; with the lock outside the fixture,
  // this was refused: "TASK-2 is held by agent:fixture".
  await buildPlanBacklog(root);
  assert.deepEqual(readdirSync(sentinel), []);
});
