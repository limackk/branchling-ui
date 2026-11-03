/**
 * branchling's own per-user directories, given to every fixture so that a
 * fixture never writes into the user's (UI-32).
 *
 * WHY EVERY HOME AND NOT ONLY DATA AND CONFIG. `take` writes its reservation
 * under the STATE home (`$XDG_STATE_HOME/branchling/locks/<hash of the
 * repository's .git>`, falling back to `~/.local/state/branchling`), and `new`,
 * `seed`, `body` and `ask` create a mutex directory there. Left to the user's
 * state home, those locks outlive the fixture: a fixture rebuilt at the same
 * path (the ui-verify skill builds them at fixed paths) is refused with
 * "TASK-2 is held by agent:fixture", and every loop and test run on the machine
 * shares one directory. Inside the fixture root, they go when it goes.
 *
 * `BRANCHLING_HOME` and `BACKLOG_STATE_DIR` win over the XDG variables, so a
 * user who exports either would otherwise pull every fixture back into their
 * own directories. branchling treats an empty value as unset.
 */

import assert from "node:assert/strict";
import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { run } from "../../src/adapter.mjs";

export const BIN = process.env.BRANCHLING_BIN || "branchling";

/** The directory, under a fixture root, that holds the fixture's homes. */
export const HOMES = "xdg";

/** The environment that gives branchling the homes under `root`. */
export function fixtureEnv(root) {
  const homes = join(root, HOMES);
  return {
    XDG_DATA_HOME: join(homes, "data"),
    XDG_CONFIG_HOME: join(homes, "config"),
    XDG_STATE_HOME: join(homes, "state"),
    XDG_CACHE_HOME: join(homes, "cache"),
    BRANCHLING_HOME: "",
    BACKLOG_STATE_DIR: "",
  };
}

/**
 * Keeps the homes out of the fixture's git repository without adding a file
 * to its tree: `.git/info/exclude`, not a `.gitignore` a test would see.
 */
export function ignoreHomes(root) {
  const info = join(root, ".git", "info");
  mkdirSync(info, { recursive: true });
  appendFileSync(join(info, "exclude"), `/${HOMES}/\n`);
}

/**
 * `branchling` run in `root` with the fixture's homes, the way the adapter
 * starts it; fails unless it exits 0, and resolves to its stdout.
 */
export function branchlingIn(root, { bin = BIN } = {}) {
  const env = fixtureEnv(root);
  return async (args, opts = {}) => {
    const { code, stdout, stderr } = await run(bin, args, { cwd: root, env, ...opts });
    assert.equal(code, 0, `branchling ${args.join(" ")} exited ${code}: ${stderr}`);
    return stdout;
  };
}

/**
 * A `bin` that records the arguments of every spawn, one line each, and then
 * runs `bin`. For the startup tests (UI-38), which count WHICH commands an
 * entry runs before its first view, not only how many. Only for arguments
 * without cmd.exe metacharacters (`--version`, `where --json`).
 */
export function argvShim(dir, { bin = BIN } = {}) {
  const log = join(dir, "argv.log");
  writeFileSync(log, "");
  let file;
  if (process.platform === "win32") {
    file = join(dir, "argv-branchling.cmd");
    writeFileSync(file, `@echo %*>>"${log}"\r\n@call "${bin}" %*\r\n`);
  } else {
    file = join(dir, "argv-branchling");
    writeFileSync(file, `#!/bin/sh\necho "$*" >> '${log}'\nexec '${bin}' "$@"\n`);
    chmodSync(file, 0o755);
  }
  return { bin: file, calls: () => readFileSync(log, "utf8").split(/\r?\n/).map(l => l.trim()).filter(Boolean) };
}
