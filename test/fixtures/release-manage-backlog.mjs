/**
 * A fixture repository for release planning (UI-8), built by the REAL
 * branchling executable. Unlike test/fixtures/release-backlog.mjs, which
 * predates `declare` and appends to its own config.yaml, this one declares
 * its release and its deploy target with `branchling declare` (0.3.0), so
 * the fixture writes no configuration by hand either.
 *
 *   node test/fixtures/release-manage-backlog.mjs [<empty-or-missing-dir>]
 *
 * builds it (in a new temporary directory when none is given) and prints the
 * backlog directory, ready for `node bin/branchling-ui.mjs --dir <it>`.
 *
 * What it holds: release 1.0; target `web` (paths app/) with the stages
 * staging and production (refs under refs/deploys/web/), and
 *
 *   TASK-1  closed, planned for 1.0, its commit in production
 *   TASK-2  open, planned for no release
 *   TASK-3  open, planned for no release
 *   TASK-4  open, planned for 1.0
 *
 * Release 1.1 is NOT declared: declaring it is what the tests and the
 * visual check do.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { BIN, buildEmptyBacklog } from "./plan-backlog.mjs";

export { BIN };
export { fixtureEnv } from "./env.mjs";

const BODY = JSON.stringify({
  goal: "A fixture task exists.",
  verification: [{ id: "noop", bash: "true", proves: "The fixture can be closed." }],
});

export const TITLES = {
  "TASK-1": "Shipped task",
  "TASK-2": "Unplanned task",
  "TASK-3": "Another unplanned task",
  "TASK-4": "Planned task",
};

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function commitAll(root, message) {
  git(root, ["add", "-A"]);
  git(root, ["-c", "user.email=fixture@example.invalid", "-c", "user.name=Fixture", "-c", "commit.gpgsign=false", "commit", "-q", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

/**
 * Builds the fixture in `root` (created if missing).
 * @returns {Promise<{ root: string, dir: string }>}
 */
export async function buildReleaseManageBacklog(root, { bin = BIN } = {}) {
  const { dir, branchling } = await buildEmptyBacklog(root, { bin });
  await branchling(["declare", "releases", "1.0", "--reason", "The first release of the fixture.", "--dir", dir]);
  await branchling([
    "declare", "deploy_targets", "web",
    "--stage", "staging=refs/deploys/web/staging",
    "--stage", "production=refs/deploys/web/production",
    "--paths", "app/",
    "--reason", "The fixture's one deployable.",
    "--dir", dir,
  ]);
  for (const [id, release] of [["TASK-1", "1.0"], ["TASK-2", ""], ["TASK-3", ""], ["TASK-4", "1.0"]]) {
    await branchling(["new", "--title", TITLES[id], "--priority", "P1", ...(release ? ["--release", release] : []), "--dir", dir], { input: BODY });
  }
  commitAll(root, "fixture backlog");
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, "app", "f1.txt"), "1\n");
  commitAll(root, "TASK-1 change");
  await branchling(["done", "TASK-1", "--actor", "agent:fixture", "--dir", dir]);
  const sha = commitAll(root, "TASK-1 close");
  git(root, ["update-ref", "refs/deploys/web/production", sha]);
  git(root, ["update-ref", "refs/deploys/web/staging", sha]);
  return { root, dir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const given = process.argv[2];
  if (given && existsSync(given) && readdirSync(given).length) {
    console.error(`release-manage-backlog: ${given} is not empty`);
    process.exit(2);
  }
  const root = given ? resolve(given) : mkdtempSync(join(tmpdir(), "branchling-ui-release-manage-"));
  const { dir } = await buildReleaseManageBacklog(root);
  console.log(dir);
}
