/**
 * Fixture backlogs for the health view (UI-28): one that passes the release
 * gate and one that a maintainer has broken in ways people actually break a
 * backlog. Built by the REAL branchling executable through the adapter's
 * exported `run`, in a git repository of their own. Used by
 * test/health-view.test.mjs, test/adapter.test.mjs and the ui-verify skill.
 *
 *   node test/fixtures/health-backlog.mjs [--broken] [<empty-or-missing-dir>]
 *
 * builds it (in a new temporary directory when none is given) and prints the
 * backlog directory, ready for `node bin/branchling-ui.mjs --dir <it>`.
 *
 * HEALTHY: three tasks made by `new`, everything committed. `doctor` exits 0
 * (it still warns: no AGENTS.md, no hooks, which is true of a fresh
 * repository) and `check` exits 0, with `product-name` and `foreign-context`
 * not run because `--dir` points at a backlog that is not branchling's own.
 *
 * BROKEN: the healthy one, then
 *   - TASK-3 is taken on the branch `feature/gamma` and committed there, then
 *     the tree goes back to main: TASK-3 is divergent (`stats` `divergent`);
 *   - TASK-1 is edited by hand to be `blocked_by: [TASK-99]`, which does not
 *     exist: the `refs` guard fails;
 *   - TASK-2 is edited by hand to priority `P9`, outside `priorities:`: the
 *     `vocabulary` guard fails and doctor's `vocabulary` check is an error;
 *   - both edits are committed, but TASK-1's history log is taken out of git
 *     (`git rm --cached`) in that commit: the `history` guard fails, because
 *     the task file is tracked and its log is not.
 *
 * THE FILES WRITTEN BY HAND are the two task files edited above: the breakage
 * IS a hand edit, which branchling's writing commands would refuse to make.
 * That is test setup in a temporary directory, never product code. Every
 * other change is a branchling command (`init`, `new`, `take`) or git.
 *
 * branchling's homes (data, config AND state, where `take` keeps its
 * reservation locks) are inside the fixture, so nothing lands in the user's.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { BIN, branchlingIn, HOMES } from "./env.mjs";

export { BIN };

export const TITLES = { "TASK-1": "Alpha exists", "TASK-2": "Beta exists", "TASK-3": "Gamma exists" };
export const DIVERGENT_BRANCH = "feature/gamma";
/** The guards the broken fixture fails, in branchling's order. */
export const BROKEN_GUARDS = ["refs", "history", "vocabulary"];

function git(root, args) {
  return execFileSync("git", ["-c", "user.email=fixture@example.invalid", "-c", "user.name=Fixture", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" }).trim();
}

/** Replaces one frontmatter line of a task file, and fails if it was not there. */
function editField(file, from, to) {
  const text = readFileSync(file, "utf8");
  assert.ok(from.test(text), `${file} has no line matching ${from}`);
  writeFileSync(file, text.replace(from, to));
}

function taskFile(dir, id) {
  const name = readdirSync(join(dir, "tasks")).find(f => f.startsWith(id + "-"));
  assert.ok(name, `no task file for ${id}`);
  return join(dir, "tasks", name);
}

/**
 * Three tasks, everything committed: `doctor` and `check` both exit 0.
 * @returns {Promise<{ root: string, dir: string }>}
 */
export async function buildHealthyBacklog(root, { bin = BIN } = {}) {
  mkdirSync(root, { recursive: true });
  const dir = join(root, "backlog");
  git(root, ["init", "-q", "-b", "main"]);
  // The fixture's own branchling homes are not part of the repository.
  writeFileSync(join(root, ".gitignore"), `${HOMES}/\n`);
  const branchling = branchlingIn(root, { bin });
  await branchling(["init", "--dir", dir, "--no-example", "--no-nudge"]);
  for (const title of Object.values(TITLES)) {
    const body = JSON.stringify({ goal: title, verification: [{ id: "noop", bash: "true", proves: "The fixture can be closed." }] });
    await branchling(["new", "--title", title, "--priority", "P1", "--dir", dir], { input: body });
  }
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "fixture backlog"]);
  return { root, dir };
}

/**
 * The healthy backlog, then broken as the header describes.
 * @returns {Promise<{ root: string, dir: string }>}
 */
export async function buildBrokenBacklog(root, { bin = BIN } = {}) {
  const { dir } = await buildHealthyBacklog(root, { bin });
  const branchling = branchlingIn(root, { bin });

  git(root, ["checkout", "-q", "-b", DIVERGENT_BRANCH]);
  await branchling(["take", "TASK-3", "--actor", "agent:fixture", "--dir", dir]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "TASK-3 taken on its branch"]);
  git(root, ["checkout", "-q", "main"]);

  editField(taskFile(dir, "TASK-1"), /^blocked_by: \[\]/m, "blocked_by: [TASK-99]");
  editField(taskFile(dir, "TASK-2"), /^priority: P1$/m, "priority: P9");
  git(root, ["add", "-A"]);
  git(root, ["rm", "-q", "--cached", "backlog/history/TASK-1.jsonl"]);
  git(root, ["commit", "-q", "-m", "hand edits, history left behind"]);
  return { root, dir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags = process.argv.slice(2);
  const broken = flags.includes("--broken");
  const given = flags.find(a => a !== "--broken");
  if (given && existsSync(given) && readdirSync(given).length) {
    console.error(`health-backlog: ${given} is not empty`);
    process.exit(2);
  }
  const root = given ? resolve(given) : mkdtempSync(join(tmpdir(), "branchling-ui-health-"));
  const { dir } = broken ? await buildBrokenBacklog(root) : await buildHealthyBacklog(root);
  console.log(dir);
}
