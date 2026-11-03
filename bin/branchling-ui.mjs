#!/usr/bin/env node
/**
 * Starts the local interface for one backlog and prints its address.
 *
 *   node bin/branchling-ui.mjs [--dir <backlog>] [--port <n>] [--bin <branchling>]
 *
 * `--dir` is passed to branchling as is; without it branchling finds the
 * backlog from the current directory, the way it does on the command line.
 *
 * Reads go through UI-2's cache (src/cache.mjs), which fingerprints the backlog
 * directory and so needs to know where it is. With `--dir` that is the
 * directory given. Without it, the directory branchling itself found is taken
 * from one `where --json` at startup (`backlog.root`; branchling 0.3.0 prints
 * it as an envelope, TL-528, UI-38). Until then this was the `root` of a
 * whole `stats --json`, which costs a backlog scan. If `where` finds no
 * backlog or fails, the server runs uncached and every view reports the
 * failure itself.
 *
 * Live refresh (UI-7): one `branchling follow --json` child for the backlog,
 * started here at startup (src/live.mjs says why not lazily), feeds the
 * pages' /api/events stream and adds its invalidations to the cache's
 * fingerprint. The server closes it when it closes.
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";

import { createAdapter } from "../src/adapter.mjs";
import { createCache, createFileChanges, servedFromCache, withLiveChanges } from "../src/cache.mjs";
import { createLive } from "../src/live.mjs";
import { createServer, DEFAULT_PORT } from "../src/server.mjs";

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    port: { type: "string" },
    bin: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log("usage: branchling-ui [--dir <backlog>] [--port <n>] [--bin <branchling>]");
  process.exit(0);
}

const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`branchling-ui: --port must be a whole number from 0 to 65535, got ${values.port}`);
  process.exit(2);
}

const dir = values.dir && resolve(values.dir);
const adapter = createAdapter({ dir, bin: values.bin, cwd: process.cwd() });
const { version, supported } = await adapter.version();
if (!supported) console.warn(`branchling-ui: branchling ${version} is outside the supported range; views may refuse to render`);

let backlogDir = dir;
if (!backlogDir) {
  try {
    const { backlog, error } = await adapter.where();
    if (backlog) backlogDir = backlog.root;
    else console.warn(`branchling-ui: no backlog found from ${process.cwd()} (${error.split("\n")[0]}); serving uncached`);
  } catch (err) {
    console.warn(`branchling-ui: no backlog found from ${process.cwd()} (${err.message.split("\n")[0]}); serving uncached`);
  }
}
// No backlog found: no follow child either. It would fail to arm and restart
// forever; the page shows live updates as off, which is the truth.
const live = backlogDir ? createLive({ adapter }) : null;
live?.start();
const changes = backlogDir && withLiveChanges(createFileChanges({ dir: backlogDir, cwd: process.cwd() }), live);
const served = backlogDir ? servedFromCache(createCache(adapter, { changes })) : adapter;

const server = await createServer({ adapter: served, live, port });
if (server.port !== port && port !== 0) console.warn(`branchling-ui: port ${port} is taken, using ${server.port}`);
console.log(`branchling-ui: ${server.url}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close().finally(() => process.exit(0)));
}
