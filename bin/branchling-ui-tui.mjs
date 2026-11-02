#!/usr/bin/env node
/**
 * The terminal interface for one backlog.
 *
 *   node bin/branchling-ui-tui.mjs [--dir <backlog>] [--bin <branchling>]
 *
 * Full screen when stdin and stdout are terminals; otherwise it prints the
 * stats screen once and exits. `--dir` is passed to branchling as is; without
 * it branchling finds the backlog from the current directory.
 *
 * Reads go through UI-2's cache (src/cache.mjs) and the branchling version is
 * checked against the supported range before the screen is taken; both are
 * wired by prepareAdapter in src/tui/start.mjs, which says why.
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";

import { createAdapter } from "../src/adapter.mjs";
import { createCache } from "../src/cache.mjs";
import { runTui } from "../src/tui/app.mjs";
import { prepareAdapter } from "../src/tui/start.mjs";

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    bin: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log("usage: branchling-ui-tui [--dir <backlog>] [--bin <branchling>]\nkeys: q quit, r refresh, Ctrl-C quit");
  process.exit(0);
}

const dir = values.dir && resolve(values.dir);
const cwd = process.cwd();

let code;
try {
  // Before runTui takes the alternate screen, so a warning stays visible.
  const { adapter } = await prepareAdapter({
    adapter: createAdapter({ dir, bin: values.bin, cwd }),
    dir,
    cwd,
    warn: message => console.warn(message),
    createCache,
  });
  code = await runTui({ adapter });
} catch (err) {
  console.error(`branchling-ui-tui: ${(err && err.stack) || err}`);
  code = 1;
}
// Exit now rather than wait for a branchling call still in flight.
process.exit(code);
