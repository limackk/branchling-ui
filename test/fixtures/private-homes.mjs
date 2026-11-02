/**
 * Imported first by every test file: this test process, and every process it
 * starts, gets branchling homes of its own (UI-32).
 *
 * The fixtures already pass their own homes to the commands that build them
 * (./env.mjs). This covers the rest: the adapters the tests create, the
 * interfaces they start and the counting shims all inherit this environment.
 * They need it: `doctor`, which only reads, was measured to create
 * branchling's state directory (`<state>/branchling/mutex`). Nothing a test
 * starts may write into the homes of the user running it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureEnv } from "./env.mjs";

const root = mkdtempSync(join(tmpdir(), "branchling-ui-test-homes-"));
Object.assign(process.env, fixtureEnv(root));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
