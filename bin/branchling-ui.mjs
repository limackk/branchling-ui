#!/usr/bin/env node
/**
 * Starts the local interface for one backlog and prints its address.
 *
 *   node bin/branchling-ui.mjs [--dir <backlog>] [--port <n>] [--bin <branchling>]
 *
 * `--dir` is passed to branchling as is; without it branchling finds the
 * backlog from the current directory, the way it does on the command line.
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";

import { createAdapter } from "../src/adapter.mjs";
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

const adapter = createAdapter({ dir: values.dir && resolve(values.dir), bin: values.bin, cwd: process.cwd() });
const { version, supported } = await adapter.version();
if (!supported) console.warn(`branchling-ui: branchling ${version} is outside the supported range; views may refuse to render`);

const server = await createServer({ adapter, port });
if (server.port !== port && port !== 0) console.warn(`branchling-ui: port ${port} is taken, using ${server.port}`);
console.log(`branchling-ui: ${server.url}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close().finally(() => process.exit(0)));
}
