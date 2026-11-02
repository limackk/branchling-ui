/**
 * A fixture backlog for the tasks view (UI-26), built by the REAL branchling
 * executable through the adapter's exported `run`. Used by
 * test/tasks-view.test.mjs and the ui-verify skill.
 *
 *   node test/fixtures/tasks-backlog.mjs [--empty] [<empty-or-missing-dir>]
 *
 * builds it (in a new temporary directory when none is given) and prints the
 * backlog directory, ready for `node bin/branchling-ui.mjs --dir <it>`.
 * `--empty` builds an initialised backlog with no task: the empty state.
 *
 * What it holds (one `seed`, then `take`, `ask` and `done`; no file is
 * written by hand, and every command is one the pinned branchling 0.2.0 has):
 *
 *   TASK-1  P0  in_progress  owner agent:fixture  epic Billing   labels ui
 *   TASK-2  P1  pending      owner unassigned     epic Billing   labels gdpr
 *   TASK-3  P2  blocked      no owner (`ask`)     epic Platform  labels ui, api
 *   TASK-4  P3  pending      owner unassigned     (no epic)      (no label)
 *   TASK-5  P1  done         ARCHIVED: not in the default (active) list
 *   TASK-6  P2  in_progress  owner local:maja     epic Platform  labels api
 *
 * The board is `main` for every task: the pin has no command that adds a
 * board (boards come from boards.yaml path rules), so the board filter is
 * proven by `main` listing everything and an undeclared board being refused.
 */

import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { BIN, buildEmptyBacklog } from "./plan-backlog.mjs";

export { BIN };

export const TASKS = [
  { id: "TASK-1", key: "invoices", title: "Invoices render in Polish", priority: "P0", epic: "Billing", labels: ["ui"], status: "in_progress", owner: "agent:fixture" },
  { id: "TASK-2", key: "refunds", title: "Refunds need a second approver", priority: "P1", epic: "Billing", labels: ["gdpr"], status: "pending", owner: "unassigned" },
  { id: "TASK-3", key: "limits", title: "Rate limits are set per key", priority: "P2", epic: "Platform", labels: ["ui", "api"], status: "blocked", owner: "" },
  { id: "TASK-4", key: "dunning", title: "Dunning emails stop at three", priority: "P3", epic: "", labels: [], status: "pending", owner: "unassigned" },
  { id: "TASK-5", key: "exports", title: "Old exports are removed", priority: "P1", epic: "Platform", labels: [], status: "done", owner: "unassigned" },
  { id: "TASK-6", key: "search", title: "Search finds tasks by title", priority: "P2", epic: "Platform", labels: ["api"], status: "in_progress", owner: "local:maja" },
];

function seedPlan() {
  return JSON.stringify({
    planVersion: 1,
    meta: {},
    tasks: TASKS.map(t => ({
      plan_id: t.key,
      title: t.title,
      goal: t.title,
      priority: t.priority,
      ...(t.epic ? { epic: t.epic } : {}),
      ...(t.labels.length ? { labels: t.labels } : {}),
      estimate: "2h",
      verification: [{ id: "noop", bash: "true", proves: "The fixture can be closed." }],
    })),
  });
}

/**
 * Builds the tasks fixture in `root` (created if missing).
 * @returns {Promise<{ root: string, dir: string }>}
 */
export async function buildTasksBacklog(root, { bin = BIN } = {}) {
  const { dir, branchling } = await buildEmptyBacklog(root, { bin });
  await branchling(["seed", "--dir", dir, "--actor", "agent:fixture"], { input: seedPlan() });
  await branchling(["take", "TASK-1", "--actor", "agent:fixture", "--dir", dir]);
  await branchling(["take", "TASK-6", "--actor", "local:maja", "--dir", dir]);
  await branchling(["ask", "TASK-3", "--question", "Per key or per account?", "--dir", dir]);
  await branchling(["done", "TASK-5", "--actor", "agent:fixture", "--dir", dir]);
  return { root, dir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags = process.argv.slice(2);
  const empty = flags.includes("--empty");
  const given = flags.find(a => a !== "--empty");
  if (given && existsSync(given) && readdirSync(given).length) {
    console.error(`tasks-backlog: ${given} is not empty`);
    process.exit(2);
  }
  const root = given ? resolve(given) : mkdtempSync(join(tmpdir(), "branchling-ui-tasks-"));
  const { dir } = empty ? await buildEmptyBacklog(root) : await buildTasksBacklog(root);
  console.log(dir);
}
