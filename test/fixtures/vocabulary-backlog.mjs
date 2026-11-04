/**
 * A fixture backlog whose vocabulary is NOT branchling's default (UI-18):
 * every status renamed, one more status than the default, an explicit
 * `status_roles:` entry, and priorities that are words rather than P0 to P3.
 * Built by the REAL branchling executable through the adapter's exported
 * `run`, in a temporary directory. Used by test/adapter.test.mjs.
 *
 * WHY A NON-DEFAULT ONE. A test over `init`'s defaults cannot tell an adapter
 * that reads the vocabulary from one that hard-codes pending/done/P0: both
 * answer the same. Here no declared name is one of the defaults, so a
 * hard-coded name matches nothing.
 *
 * THE ONE FILE WRITTEN BY HAND. No branchling command declares statuses or
 * priorities (`declare` grows only releases and deploy targets), so the
 * fixture rewrites lines of ITS OWN temporary config.yaml, as
 * actions-backlog.mjs appends roles. Every line it replaces must be there as
 * `init` wrote it, or the build fails: a replacement that silently matched
 * nothing would leave the default vocabulary and a test that proves nothing.
 * No task file is ever written here, and the fixture holds no task: `new`
 * refuses one while `_template.md` still carries the default `status:`, and
 * the vocabulary is read from config.yaml alone, so a task would prove
 * nothing more and need a second hand-written file.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BIN, branchlingIn, fixtureEnv, ignoreHomes } from "./env.mjs";

export { BIN, fixtureEnv };

/** The statuses in declared order, with the role branchling must report for each. */
export const STATUSES = [
  { name: "todo", archived: false, role: "open", roleSource: "derived" },
  { name: "doing", archived: false, role: "active", roleSource: "derived" },
  { name: "parked", archived: false, role: "waiting", roleSource: "derived" },
  { name: "review", archived: false, role: "waiting", roleSource: "status_roles" },
  { name: "shipped", archived: true, role: "closed", roleSource: "derived" },
  { name: "dropped", archived: true, role: "cancelled", roleSource: "derived" },
];

/** The priorities in declared order, most urgent first. */
export const PRIORITIES = ["urgent", "high", "normal", "someday"];

/** `init`'s line -> this fixture's line. */
const REWRITES = [
  ["statuses: [pending, in_progress, blocked, done, cancelled]", `statuses: [${STATUSES.map(s => s.name).join(", ")}]`],
  ["archived_statuses: [done, cancelled]", "archived_statuses: [shipped, dropped]"],
  ["dashboard_open_statuses: [pending, in_progress, blocked]", "dashboard_open_statuses: [todo, doing, parked, review]"],
  ["reason_required_statuses: [blocked, cancelled]", "reason_required_statuses: [parked, dropped]"],
  ["priorities: [P0, P1, P2, P3]", `priorities: [${PRIORITIES.join(", ")}]`],
  ["# in_progress_status: in_progress", "in_progress_status: doing"],
];

/**
 * Builds the fixture in `root` (created if missing).
 * @returns {Promise<{ root: string, dir: string, env: Record<string, string> }>}
 */
export async function buildVocabularyBacklog(root, { bin = BIN } = {}) {
  mkdirSync(root, { recursive: true });
  const dir = join(root, "backlog");
  const env = fixtureEnv(root);
  const branchling = branchlingIn(root, { bin });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  ignoreHomes(root);
  await branchling(["init", "--dir", dir, "--no-example", "--no-nudge"]);
  const file = join(dir, "config.yaml");
  let config = readFileSync(file, "utf8");
  for (const [from, to] of REWRITES) {
    const lines = config.split("\n");
    // Exact, or exact once a trailing comment (`# [tree]`) is dropped.
    const at = lines.findIndex(line => line.trim() === from || line.replace(/\s+#.*$/, "").trim() === from);
    if (at === -1) throw new Error(`vocabulary-backlog: init no longer writes ${JSON.stringify(from)}; update REWRITES`);
    lines[at] = to;
    config = lines.join("\n");
  }
  writeFileSync(file, `${config.trimEnd()}\nstatus_roles:\n  review: waiting\n`);
  return { root, dir, env };
}
