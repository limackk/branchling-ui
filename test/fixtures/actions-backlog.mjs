/**
 * A fixture backlog for the task panel's actions (UI-30): take, release and
 * handoff, built by the REAL branchling executable through the adapter's
 * exported `run`. Used by test/task-actions.test.mjs, test/adapter.test.mjs
 * and the ui-verify pass.
 *
 *   node test/fixtures/actions-backlog.mjs [<empty-or-missing-dir>]
 *
 * builds it (in a new temporary directory when none is given) and prints the
 * backlog directory. Serve it with the same private homes the fixture used,
 * so `take` locks stay inside it:
 *
 *   XDG_STATE_HOME=<root>/xdg/state XDG_DATA_HOME=<root>/xdg/data \
 *   XDG_CONFIG_HOME=<root>/xdg/config BACKLOG_ACTOR=local:maja \
 *   node bin/branchling-ui.mjs --dir <root>/backlog --port 4130
 *
 * What it holds (`init`, `new`, `take` and `done`; every command is one the
 * pinned branchling 0.2.0 has):
 *
 *   TASK-1  pending, nobody's        take it; then release or hand it off
 *   TASK-2  in progress, OTHER_ACTOR  every action on it is refused for
 *                                     anybody else (`other-owner`)
 *   TASK-3  done                      take is refused (`closed`)
 *   TASK-4  pending, nobody's        a second task to take and hand off
 *
 * THE ONE FILE WRITTEN BY HAND. No branchling command declares `roles:`, and
 * `handoff --to-role` refuses a backlog that declares none, so the fixture
 * appends ROLES to ITS OWN temporary config.yaml (as release-backlog.mjs does
 * for deploy_targets). No task file is ever written here.
 *
 * branchling's homes are inside the fixture root (fixtureEnv from ./env.mjs,
 * UI-32), so `take` never writes a lock into the user's own state directory
 * and two builds can never collide on one.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { BIN, branchlingIn, fixtureEnv, ignoreHomes } from "./env.mjs";

export { BIN, fixtureEnv };

/** The roles this fixture declares, and the actor that holds TASK-2. */
export const ROLES = ["developer", "reviewer"];
export const OTHER_ACTOR = "agent:other";

export const TITLES = {
  "TASK-1": "Receipts are emailed after payment",
  "TASK-2": "Refunds need a second approver",
  "TASK-3": "The old receipt template is removed",
  "TASK-4": "Receipts carry the VAT number",
};

/**
 * Builds the fixture in `root` (created if missing).
 * @returns {Promise<{ root: string, dir: string, env: Record<string, string> }>}
 */
export async function buildActionsBacklog(root, { bin = BIN } = {}) {
  mkdirSync(root, { recursive: true });
  const dir = join(root, "backlog");
  // With no config of its own, branchling's actor falls back to its default
  // unless BACKLOG_ACTOR is set.
  const env = fixtureEnv(root);
  const branchling = branchlingIn(root, { bin });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  ignoreHomes(root);
  await branchling(["init", "--dir", dir, "--no-example", "--no-nudge"]);
  appendFileSync(join(dir, "config.yaml"), `\nroles: [${ROLES.join(", ")}]\n`);
  for (const title of Object.values(TITLES)) {
    const body = JSON.stringify({
      goal: title,
      verification: [{ id: "noop", bash: "true", proves: "The fixture can be closed." }],
    });
    await branchling(["new", "--title", title, "--priority", "P2", "--dir", dir], { input: body });
  }
  await branchling(["take", "TASK-2", "--actor", OTHER_ACTOR, "--dir", dir]);
  await branchling(["done", "TASK-3", "--actor", "agent:fixture", "--dir", dir]);
  return { root, dir, env };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const given = process.argv[2];
  if (given && existsSync(given) && readdirSync(given).length) {
    console.error(`actions-backlog: ${given} is not empty`);
    process.exit(2);
  }
  const root = given ? resolve(given) : mkdtempSync(join(tmpdir(), "branchling-ui-actions-"));
  const { dir } = await buildActionsBacklog(root);
  console.log(dir);
}
