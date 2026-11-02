/**
 * A fixture backlog with questions waiting on a person, built by the REAL
 * branchling executable the way test/fixtures/plan-backlog.mjs builds its own.
 * Used by the ui-verify skill to run the decisions view (UI-5).
 *
 *   node test/fixtures/decisions-backlog.mjs [--no-questions] [<empty-or-missing-dir>]
 *
 * builds it (in a new temporary directory when none is given) and prints the
 * backlog directory, ready for `node bin/branchling-ui.mjs --dir <it>`.
 * `--no-questions` builds the same tasks with no question asked: the empty
 * state.
 *
 * What it holds, and what the decisions view then lists:
 *
 *   TASK-1  asked with two options, the first recommended   -> listed
 *   TASK-2  asked with no options                           -> listed
 *   TASK-3  no question                                     -> not listed
 *
 * branchling 0.2's `log --decisions --json` does not report a question's
 * options (UI-23), so TASK-1 is offered the free-text answer too until it does.
 * Every command used is one the pinned branchling (0.2.0) has. No task file is
 * ever written here.
 */

import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { BIN, buildEmptyBacklog } from "./plan-backlog.mjs";

export const TITLES = {
  "TASK-1": "Pick a database",
  "TASK-2": "Ship the beta",
  "TASK-3": "Write the changelog",
};

/** The `seed` plan: the three tasks, numbered TASK-1..3 in this order. */
function seedPlan() {
  return JSON.stringify({
    planVersion: 1,
    meta: {},
    tasks: Object.values(TITLES).map((title, i) => ({
      plan_id: `t${i + 1}`,
      title,
      goal: title,
      priority: "P1",
      estimate: "2h",
      verification: [{ id: "noop", bash: "true", proves: "The fixture can be closed." }],
    })),
  });
}

/**
 * Builds the fixture in `root` (created if missing).
 * @returns {Promise<{ root: string, dir: string }>}
 */
export async function buildDecisionsBacklog(root, { bin = BIN, questions = true } = {}) {
  const { dir, branchling } = await buildEmptyBacklog(root, { bin });
  await branchling(["seed", "--dir", dir, "--actor", "agent:fixture"], { input: seedPlan() });
  if (questions) {
    await branchling([
      "ask", "TASK-1", "--question", "Which database should the cache use?",
      "--option", "Postgres: already deployed, solid", "--option", "SQLite: quickest to start",
      "--recommend", "1", "--actor", "agent:fixture", "--dir", dir,
    ]);
    await branchling(["ask", "TASK-2", "--question", "Is the beta ready to ship?", "--actor", "agent:fixture", "--dir", dir]);
  }
  return { root, dir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags = process.argv.slice(2);
  const questions = !flags.includes("--no-questions");
  const given = flags.find(a => a !== "--no-questions");
  if (given && existsSync(given) && readdirSync(given).length) {
    console.error(`decisions-backlog: ${given} is not empty`);
    process.exit(2);
  }
  const root = given ? resolve(given) : mkdtempSync(join(tmpdir(), "branchling-ui-decisions-"));
  const { dir } = await buildDecisionsBacklog(root, { questions });
  console.log(dir);
}
