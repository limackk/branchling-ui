/**
 * A fixture repository with one deploy target, built by the REAL branchling
 * executable the way test/release-view.test.mjs builds its own. Used by the
 * ui-verify skill to run the release view (UI-4) on screen.
 *
 *   node test/fixtures/release-backlog.mjs [--no-targets] [<empty-or-missing-dir>]
 *
 * builds it (in a new temporary directory when none is given) and prints the
 * backlog directory, ready for `node bin/branchling-ui.mjs --dir <it>`.
 * `--no-targets` builds a backlog with one task and no deploy target: the
 * empty state.
 *
 * What it holds: target `web` with the stages staging and production (refs
 * under refs/deploys/web/), releases 1.0 and 1.1, and
 *
 *   TASK-1  closed, its commit in production
 *   TASK-2  closed, its commit in staging, waiting for production
 *   TASK-3  closed, its commit on the trunk, waiting for staging
 *   TASK-4  open, planned for release 1.1
 *
 * No branchling command declares `deploy_targets` or `releases`, so the
 * fixture appends them to ITS OWN temporary config.yaml and moves ITS OWN refs
 * with git, the way a deployment would. Every task is created and closed with
 * branchling commands; no task file is written here.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { BIN, buildEmptyBacklog } from "./plan-backlog.mjs";

const BODY = JSON.stringify({
  goal: "A fixture task exists.",
  verification: [{ id: "noop", bash: "true", proves: "The fixture can be closed." }],
});

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
export async function buildReleaseBacklog(root, { bin = BIN, targets = true } = {}) {
  const { dir, branchling } = await buildEmptyBacklog(root, { bin });
  if (!targets) {
    await branchling(["new", "--title", "Fixture task", "--priority", "P1", "--dir", dir], { input: BODY });
    commitAll(root, "fixture backlog");
    return { root, dir };
  }
  appendFileSync(join(dir, "config.yaml"), [
    "",
    "releases: [1.0, 1.1]",
    "",
    "deploy_targets:",
    "  - name: web",
    "    paths: [app/]",
    "    stages:",
    "      - { name: staging, ref: refs/deploys/web/staging }",
    "      - { name: production, ref: refs/deploys/web/production }",
    "",
  ].join("\n"));
  commitAll(root, "fixture backlog");
  for (const [title, release] of [["Shipped task", "1.0"], ["Staged task", "1.1"], ["Trunk task", "1.1"], ["Open task", "1.1"]]) {
    await branchling(["new", "--title", title, "--priority", "P1", "--release", release, "--dir", dir], { input: BODY });
  }
  commitAll(root, "fixture tasks");
  mkdirSync(join(root, "app"));
  for (const n of [1, 2, 3]) {
    writeFileSync(join(root, "app", `f${n}.txt`), `${n}\n`);
    commitAll(root, `TASK-${n} change ${n}`);
    await branchling(["done", `TASK-${n}`, "--actor", "agent:fixture", "--dir", dir]);
    const sha = commitAll(root, `TASK-${n} close`);
    if (n === 1) git(root, ["update-ref", "refs/deploys/web/production", sha]);
    if (n === 2) git(root, ["update-ref", "refs/deploys/web/staging", sha]);
  }
  return { root, dir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags = process.argv.slice(2);
  const targets = !flags.includes("--no-targets");
  const given = flags.find(a => a !== "--no-targets");
  if (given && existsSync(given) && readdirSync(given).length) {
    console.error(`release-backlog: ${given} is not empty`);
    process.exit(2);
  }
  const root = given ? resolve(given) : mkdtempSync(join(tmpdir(), "branchling-ui-release-"));
  const { dir } = await buildReleaseBacklog(root, { targets });
  console.log(dir);
}
