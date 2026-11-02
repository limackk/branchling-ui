/**
 * A fixture backlog for the task panel (UI-27), built by the REAL branchling
 * executable through the adapter's exported `run`, the way the other fixtures
 * build theirs. Used by test/task-panel.test.mjs and the ui-verify skill.
 *
 *   node test/fixtures/task-backlog.mjs [<empty-or-missing-dir>]
 *
 * builds it (in a new temporary directory when none is given) and prints the
 * backlog directory, ready for `node bin/branchling-ui.mjs --dir <it>`.
 *
 * What it holds (one `seed`, then `take`, `ask`, `decide` and `done`; no file
 * is written by hand, and every command is one the pinned branchling 0.2.0 has):
 *
 *   TASK-1  P1  the task with a history: seeded, taken, asked, decided.
 *               A long body (goal, context, steps). Blocks TASK-2.
 *   TASK-2  P2  pending, blocked_by TASK-1 (open) and TASK-4 (closed).
 *   TASK-3  P2  pending; its TITLE and goal hold HTML and a script, which the
 *               panel must show as text.
 *   TASK-4  P3  done: archived, reached through the panel all the same.
 *
 * The panel cannot show a body yet: branchling 0.2 has no read that prints
 * it (see src/view-model/task.mjs), so the bodies here are for the day one
 * does, and for the manual check that nothing of them leaks into the page.
 */

import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { BIN, buildEmptyBacklog } from "./plan-backlog.mjs";

export { BIN };

export const HTML_TITLE = "<img src=x onerror=alert(1)> titles <b>stay</b> text";
export const QUESTION = "Should the amounts round half up or half even?";
export const ANSWER = "Half even: it is what the accounting export expects.";

export const TITLES = {
  "TASK-1": "Invoices round amounts the way accounting does",
  "TASK-2": "Credit notes reuse the invoice rounding",
  "TASK-3": HTML_TITLE,
  "TASK-4": "The old rounding helper is removed",
};

function seedPlan() {
  const verification = [{ id: "noop", bash: "true", proves: "The fixture can be closed." }];
  return JSON.stringify({
    planVersion: 1,
    meta: {},
    tasks: [
      {
        plan_id: "rounding",
        title: TITLES["TASK-1"],
        goal: "Every amount on an invoice is rounded **once**, at the end, the way the `accounting` export expects. See [the export notes](https://example.com/export) and [a bad link](javascript:alert(1)).",
        context: Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} of the context: rounding happens in three places today, and each one rounds a little differently, which is why the totals drift by a cent on long invoices.`).join("\n\n"),
        steps: ["Find every place that rounds", "Round once, in `totals()`", "Compare a year of invoices against the export"],
        priority: "P1",
        epic: "Billing",
        estimate: "1d",
        verification,
      },
      {
        plan_id: "credit",
        title: TITLES["TASK-2"],
        goal: "Credit notes round like invoices.",
        priority: "P2",
        epic: "Billing",
        estimate: "2h",
        blocked_by: ["rounding", "helper"],
        verification,
      },
      {
        plan_id: "html",
        title: TITLES["TASK-3"],
        goal: "<script>alert('body')</script> A body with <b>markup</b> and <img src=x onerror=alert(2)> is shown as text.",
        priority: "P2",
        estimate: "1h",
        verification,
      },
      {
        plan_id: "helper",
        title: TITLES["TASK-4"],
        goal: "The helper nobody calls any more is gone.",
        priority: "P3",
        estimate: "1h",
        verification,
      },
    ],
  });
}

/**
 * Builds the task-panel fixture in `root` (created if missing).
 * @returns {Promise<{ root: string, dir: string }>}
 */
export async function buildTaskBacklog(root, { bin = BIN } = {}) {
  const { dir, branchling } = await buildEmptyBacklog(root, { bin });
  await branchling(["seed", "--dir", dir, "--actor", "agent:fixture"], { input: seedPlan() });
  await branchling(["take", "TASK-1", "--actor", "agent:fixture", "--dir", dir]);
  const asked = JSON.parse(await branchling(["ask", "TASK-1", "--question", QUESTION, "--actor", "agent:fixture", "--json", "--dir", dir]));
  const questionId = asked.question?.id || asked.event?.id || asked.id;
  await branchling(["decide", "TASK-1", "--resolves", String(questionId), "--reason", ANSWER, "--actor", "local:maja", "--json", "--dir", dir]);
  await branchling(["done", "TASK-4", "--actor", "agent:fixture", "--dir", dir]);
  return { root, dir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const given = process.argv[2];
  if (given && existsSync(given) && readdirSync(given).length) {
    console.error(`task-backlog: ${given} is not empty`);
    process.exit(2);
  }
  const root = given ? resolve(given) : mkdtempSync(join(tmpdir(), "branchling-ui-task-"));
  const { dir } = await buildTaskBacklog(root);
  console.log(dir);
}
