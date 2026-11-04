/**
 * A fixture backlog for the overview (UI-29): something in every part of
 * the page, built by the REAL branchling executable. It is the plan fixture
 * (test/fixtures/plan-backlog.mjs) plus an open question and a failing setup
 * check. Used by test/overview.test.mjs and the ui-verify skill.
 *
 *   node test/fixtures/overview-backlog.mjs [--empty] [<empty-or-missing-dir>]
 *
 * builds it (in a new temporary directory when none is given) and prints the
 * backlog directory, ready for `node bin/branchling-ui.mjs --dir <it>`.
 * `--empty` builds an initialised backlog with no task, no plan and no
 * question instead: every part's empty state.
 *
 * What it holds, and where the overview shows it:
 *
 *   needs a person   TASK-5 asked a question (`ask`)      -> 1 open question
 *                    INDEX.yaml staged in git             -> doctor `git-tracked` fails
 *                    TASK-3 blocked_by TASK-2 (still open) -> stats `blocked` 1
 *   where it stands  wave 1 "Foundation" is active        -> wave 1 of 2
 *                    TASK-1 may start now, TASK-2 taken    -> 1 in flight
 *
 * THE FAILING CHECK. `doctor` reports `git-tracked` ("views out of the
 * index") as an error when a view branchling generates is in git's index:
 * INDEX.yaml is regenerated from the tasks on every command, so a committed
 * copy conflicts between branches. Here `git add -f` puts it there, the way a
 * person who overrides the backlog's own .gitignore does. That is git, not a
 * hand-written file: no file is written by hand here or in plan-backlog,
 * whose plan starts with `plan init` (see that module).
 *
 * The question is on TASK-5, the unplanned task, so the plan's waves and
 * what may start now stay exactly as plan-backlog describes them. Every
 * branchling command used here is one the pinned branchling (0.3.0) has;
 * plan-backlog's `plan init` needs the release after it.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { branchlingIn } from "./env.mjs";
import { BIN, buildEmptyBacklog, buildPlanBacklog } from "./plan-backlog.mjs";

export const QUESTION = "Should the garden have a fence?";
export const QUESTION_TASK = "TASK-5";
export { BIN };

/** The doctor check this fixture fails, by its id. */
export const FAILING_CHECK = "git-tracked";

/**
 * Builds the fixture in `root` (created if missing).
 * @returns {Promise<{ root: string, dir: string }>}
 */
export async function buildOverviewBacklog(root, { bin = BIN } = {}) {
  const { dir } = await buildPlanBacklog(root, { bin });
  await branchlingIn(root, { bin })([
    "ask", QUESTION_TASK, "--question", QUESTION,
    "--option", "Yes: keeps the rabbits out", "--option", "No: leave it open", "--recommend", "1",
    "--actor", "agent:fixture", "--dir", dir,
  ]);
  execFileSync("git", ["add", "-f", "backlog/INDEX.yaml"], { cwd: root });
  return { root, dir };
}

/** An initialised backlog with nothing in it. */
export async function buildEmptyOverviewBacklog(root, { bin = BIN } = {}) {
  const { dir } = await buildEmptyBacklog(root, { bin });
  return { root, dir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags = process.argv.slice(2);
  const empty = flags.includes("--empty");
  const given = flags.find(a => a !== "--empty");
  if (given && existsSync(given) && readdirSync(given).length) {
    console.error(`overview-backlog: ${given} is not empty`);
    process.exit(2);
  }
  const root = given ? resolve(given) : mkdtempSync(join(tmpdir(), "branchling-ui-overview-"));
  const { dir } = empty ? await buildEmptyOverviewBacklog(root) : await buildOverviewBacklog(root);
  console.log(dir);
}
