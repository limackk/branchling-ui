/**
 * A fixture backlog with a two-wave execution plan, built by the REAL branchling
 * executable through the adapter's exported `run`, the way the contract tests
 * build theirs. Used by test/plan-view.test.mjs, test/server.test.mjs and the
 * ui-verify skill.
 *
 *   node test/fixtures/plan-backlog.mjs [--no-plan] [<empty-or-missing-dir>]
 *
 * builds it (in a new temporary directory when none is given) and prints the
 * backlog directory, ready for `node bin/branchling-ui.mjs --dir <it>`.
 * `--no-plan` builds an initialised backlog with no plan.yaml instead: the
 * empty state.
 *
 * What it holds, and what `branchling plan --json` then says about it:
 *
 *   wave 1 "Foundation"  TASK-1 pending       -> may start now (nextUp)
 *                        TASK-2 in progress   -> in flight (inProgress), taken
 *   wave 2 "Building"    TASK-3 pending, blocked_by TASK-2
 *                        TASK-4 done          -> overtaken (stale): closed in a
 *                                                wave after the active one
 *   unplanned            TASK-5 pending       -> unplanned, coverage 1 of 4 open
 *
 * THE ONE FILE WRITTEN BY HAND. branchling refuses to create plan.yaml: `plan
 * add --why` creates a WAVE, but on a backlog with no plan it answers "there is
 * no plan to edit", because a plan is a decision a person makes and the tool
 * will not write an order with no argument for it. So, like the person who
 * decides to have a plan, this fixture writes the file's header (the rationale
 * and an empty `waves:` key) and nothing else. Every wave and every membership
 * is then written by `branchling plan add`, every task and its `blocked_by` by
 * one `seed` (which cannot create the plan: its `wave` key names an EXISTING
 * wave), and every status change by `take` and `done`. No task file is ever
 * written here. Every command used is one the pinned branchling (0.2.0, from
 * package-lock.json) has; check with `node_modules/.bin/branchling --help`.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { BIN, branchlingIn, fixtureEnv, ignoreHomes } from "./env.mjs";

// Re-exported for the fixtures built on this one; ./env.mjs is their source.
export { BIN, fixtureEnv };

export const PLAN_RATIONALE = "The foundation first, the house on it after.";
export const WAVES = [
  { name: "Foundation", why: "Nothing stands without it." },
  { name: "Building", why: "The house goes up on the foundation." },
];
export const TITLES = {
  "TASK-1": "Foundation is laid",
  "TASK-2": "Walls stand",
  "TASK-3": "Roof is on",
  "TASK-4": "Doors hang",
  "TASK-5": "A garden exists",
};

/** The `seed` plan: the five tasks, numbered TASK-1..5 in this order. */
function seedPlan() {
  const keys = ["foundation", "walls", "roof", "doors", "garden"];
  return JSON.stringify({
    planVersion: 1,
    meta: {},
    tasks: Object.values(TITLES).map((title, i) => ({
      plan_id: keys[i],
      title,
      goal: title,
      priority: "P1",
      estimate: "2h",
      verification: [{ id: "noop", bash: "true", proves: "The fixture can be closed." }],
      ...(keys[i] === "roof" ? { blocked_by: ["walls"] } : {}),
    })),
  });
}

/** A git repository with an initialised, empty backlog at `<root>/backlog`. */
export async function buildEmptyBacklog(root, { bin = BIN } = {}) {
  mkdirSync(root, { recursive: true });
  const dir = join(root, "backlog");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  // branchling's homes live in the fixture (./env.mjs), invisible to its git.
  ignoreHomes(root);
  const branchling = branchlingIn(root, { bin });
  await branchling(["init", "--dir", dir, "--no-example", "--no-nudge"]);
  return { root, dir, branchling };
}

/**
 * Builds the two-wave fixture in `root` (created if missing).
 * @returns {Promise<{ root: string, dir: string }>}
 */
export async function buildPlanBacklog(root, { bin = BIN } = {}) {
  const { dir, branchling } = await buildEmptyBacklog(root, { bin });
  await branchling(["seed", "--dir", dir, "--actor", "agent:fixture"], { input: seedPlan() });
  writeFileSync(join(dir, "plan.yaml"), `rationale: ${JSON.stringify(PLAN_RATIONALE)}\nwaves:\n`);
  await branchling(["plan", "add", "TASK-1", "TASK-2", "--wave", WAVES[0].name, "--why", WAVES[0].why, "--dir", dir]);
  await branchling(["plan", "add", "TASK-3", "TASK-4", "--wave", WAVES[1].name, "--why", WAVES[1].why, "--dir", dir]);
  await branchling(["take", "TASK-2", "--actor", "agent:fixture", "--dir", dir]);
  await branchling(["done", "TASK-4", "--actor", "agent:fixture", "--dir", dir]);
  return { root, dir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags = process.argv.slice(2);
  const noPlan = flags.includes("--no-plan");
  const given = flags.find(a => a !== "--no-plan");
  if (given && existsSync(given) && readdirSync(given).length) {
    console.error(`plan-backlog: ${given} is not empty`);
    process.exit(2);
  }
  const root = given ? resolve(given) : mkdtempSync(join(tmpdir(), "branchling-ui-plan-"));
  const { dir } = noPlan ? await buildEmptyBacklog(root) : await buildPlanBacklog(root);
  console.log(dir);
}
