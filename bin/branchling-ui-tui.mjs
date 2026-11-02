#!/usr/bin/env node
/**
 * The terminal interface for one backlog.
 *
 *   node bin/branchling-ui-tui.mjs [--dir <backlog>] [--bin <branchling>] [--screen <name>]
 *
 * Full screen when stdin and stdout are terminals, starting on `--screen`
 * (stats, plan, release or decisions; stats by default); otherwise it prints
 * that screen once and exits. `--dir` is passed to branchling as is; without
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
import { KEYS } from "../src/tui/render.mjs";
import { SCREENS } from "../src/tui/screens/index.mjs";
import { prepareAdapter } from "../src/tui/start.mjs";

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    bin: { type: "string" },
    screen: { type: "string", default: SCREENS[0].id },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  const keys = KEYS.map(k => `${k.key} ${k.label}`).join(", ");
  console.log(`usage: branchling-ui-tui [--dir <backlog>] [--bin <branchling>] [--screen ${SCREENS.map(s => s.id).join("|")}]\nkeys: ${keys}, Ctrl-C quit`);
  process.exit(0);
}

if (!SCREENS.some(s => s.id === values.screen)) {
  console.error(`branchling-ui-tui: --screen takes one of ${SCREENS.map(s => s.id).join(", ")}, not ${JSON.stringify(values.screen)}`);
  process.exit(2);
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
  code = await runTui({ adapter, screen: values.screen });
} catch (err) {
  console.error(`branchling-ui-tui: ${(err && err.stack) || err}`);
  code = 1;
}
// Exit now rather than wait for a branchling call still in flight.
process.exit(code);
