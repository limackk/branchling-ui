/**
 * The terminal interface (UI-16). The renderer is a pure function, tested on
 * hand-built models; the loop runs over fake streams and a fake process, so
 * the tests assert on the exact bytes written and on the raw-mode state; the
 * last tests feed the REAL branchling executable, over a fixture backlog in a
 * temporary directory, through the adapter and the view model into the
 * renderer and through the entry point, and check the startup wiring
 * (UI-20): the version warning and the read cache around the adapter.
 */

import "./fixtures/private-homes.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFile, execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { BranchlingRefusal, createAdapter, run } from "../src/adapter.mjs";
import { STATS_TEXT, statsModel } from "../src/view-model/stats.mjs";
import { fromAdapterError, loadingState } from "../src/view-model/states.mjs";
import { KEYS, actionFor, maxScroll, renderScreen } from "../src/tui/render.mjs";
import { SCREENS, screenById } from "../src/tui/screens/index.mjs";
import { PLAN_TEXT } from "../src/view-model/plan.mjs";
import { RELEASE_TEXT } from "../src/view-model/release.mjs";
import { DECISIONS_TEXT } from "../src/view-model/decisions.mjs";
import { buildEmptyBacklog, buildPlanBacklog } from "./fixtures/plan-backlog.mjs";
import { buildReleaseBacklog } from "./fixtures/release-backlog.mjs";
import { buildDecisionsBacklog } from "./fixtures/decisions-backlog.mjs";
import { ESC, canDriveScreen, colourEnabled } from "../src/tui/terminal.mjs";
import { runTui } from "../src/tui/app.mjs";
import { prepareAdapter } from "../src/tui/start.mjs";
import { createCache, createFileChanges } from "../src/cache.mjs";
import { argvShim, fixtureEnv } from "./fixtures/env.mjs";

const SGR_RE = /\x1b\[[0-9;]*m/;
const ANY_CSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** What a terminal would show: every control sequence removed. */
const visible = text => text.replace(ANY_CSI, "");
const columns = line => [...visible(line)].length;

function envelope(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "stats",
    root: "/tmp/a/rather/long/path/to/some/repository/that/does/not/fit/at/eighty/columns/backlog",
    stats: {
      total: 3,
      active: 3,
      archived: 0,
      blocked: 1,
      byStatus: { pending: 1, in_progress: 1, waiting_for_a_very_long_custom_status_name_that_overflows_the_column: 1, done: 0 },
      byPriority: { P2: 1, P1: 2 },
      openHours: { hours: 4, unknown: 1 },
      ...overrides,
    },
  };
}

function fakeStdout({ isTTY = true, columns = 80, rows = 24 } = {}) {
  const out = new EventEmitter();
  Object.assign(out, { isTTY, columns, rows, written: "" });
  out.write = chunk => { out.written += chunk; return true; };
  return out;
}

function fakeStdin({ isTTY = true } = {}) {
  const input = new EventEmitter();
  Object.assign(input, { isTTY, isRaw: false, rawCalls: [], paused: true });
  input.setRawMode = on => { input.isRaw = on; input.rawCalls.push(on); return input; };
  input.setEncoding = () => input;
  input.resume = () => { input.paused = false; return input; };
  input.pause = () => { input.paused = true; return input; };
  return input;
}

/** A fake terminal session around runTui. */
function session({ adapter, env = {}, stdinTTY = true, stdoutTTY = true, render, columns = 80, rows = 24, screen } = {}) {
  const stdin = fakeStdin({ isTTY: stdinTTY });
  const stdout = fakeStdout({ isTTY: stdoutTTY, columns, rows });
  const stderr = fakeStdout({ isTTY: false });
  const proc = new EventEmitter();
  const done = runTui({ adapter, stdin, stdout, stderr, proc, env, ...(render ? { render } : {}), ...(screen ? { screen } : {}) });
  return { stdin, stdout, stderr, proc, done };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const okAdapter = (env = envelope()) => {
  const adapter = { calls: 0, stats: async () => { adapter.calls++; return env; } };
  return adapter;
};

function assertRestored({ stdin, stdout }) {
  assert.equal(stdin.isRaw, false, "raw mode is off");
  assert.ok(stdout.written.endsWith(ESC.altScreenOff + ESC.showCursor), "alt screen left and cursor shown, last");
  assert.equal(stdout.written.split(ESC.altScreenOff).length - 1, 1, "restored exactly once");
}

// --- the renderer ------------------------------------------------------------

test("the stats screen fits 80 columns, every line, with colour on and off", () => {
  const model = statsModel(envelope());
  for (const colour of [false, true]) {
    for (const lines of [renderScreen(model, { width: 80, colour }), renderScreen(model, { width: 80, height: 24, colour, keys: KEYS })]) {
      assert.ok(lines.length > 6);
      for (const line of lines) assert.ok(columns(line) <= 80, `${columns(line)} columns: ${JSON.stringify(visible(line))}`);
    }
  }
  // Positive control: the long root and the long status really were longer than 80.
  assert.ok(envelope().root.length > 80);
  const text = renderScreen(model, { width: 80 }).join("\n");
  for (const label of ["Tasks 3", "Active 3", "Blocked 1", "Archived 0", STATS_TEXT.byStatus, STATS_TEXT.byPriority, "in progress", "P1"]) {
    assert.ok(text.includes(label), label);
  }
  assert.ok(text.indexOf("P1") < text.indexOf("P2"), "the model's order is kept");
  assert.ok(text.split("\n")[0].endsWith("eighty/columns/backlog"), "a long root keeps its end");
});

test("the full screen is exactly as high as the terminal and ends with the key map", () => {
  const model = statsModel(envelope());
  for (const rows of [24, 8]) {
    const lines = renderScreen(model, { width: 80, height: rows, keys: KEYS });
    assert.equal(lines.length, rows);
    assert.equal(lines.at(-1), "1 stats  2 plan  3 release  4 decisions  tab next  j/k scroll  r refresh  q quit");
  }
});

test("with colour off the renderer writes no escape code at all", () => {
  const models = [
    statsModel(envelope()),
    statsModel(envelope(), { stale: true }),
    statsModel(envelope({ total: 0, active: 0, byStatus: {}, byPriority: {} })),
    loadingState("stats"),
    fromAdapterError("stats", new BranchlingRefusal({ schemaVersion: 1, kind: "stats", refusalKind: "held", refusal: "held" }, 1)),
    fromAdapterError("stats", new Error("boom")),
  ];
  for (const model of models) {
    const plain = renderScreen(model, { width: 80, height: 24, colour: false, keys: KEYS }).join("\n");
    assert.doesNotMatch(plain, /\x1b/, model.state);
    // Positive control: the same model with colour on does carry SGR codes.
    assert.match(renderScreen(model, { width: 80, colour: true, keys: KEYS }).join("\n"), SGR_RE, model.state);
  }
});

test("control characters from the backlog are never passed to the terminal", () => {
  const model = statsModel(envelope({ byStatus: { "evil\x1b[2Jstatus": 1, "bell\x07": 1 } }));
  const text = renderScreen(model, { width: 80 }).join("\n");
  assert.doesNotMatch(text, /[\x00-\x09\x0b-\x1f\x7f]/);
  assert.ok(text.includes("evil?[2Jstatus"), "the label is still shown, defused");
});

test("every state from the view model has its own screen; a refusal is never the empty one", () => {
  const show = model => renderScreen(model, { width: 80 }).join("\n");
  assert.ok(show(loadingState("stats")).includes(STATS_TEXT.loading));
  assert.ok(show(statsModel(envelope({ total: 0, active: 0, byStatus: {}, byPriority: {} }))).includes(STATS_TEXT.empty));
  assert.ok(show(statsModel(envelope(), { stale: true })).includes(STATS_TEXT.stale));
  assert.ok(!show(statsModel(envelope())).includes(STATS_TEXT.stale), "positive control: fresh is not stale");

  const refusal = fromAdapterError("stats", new BranchlingRefusal({ schemaVersion: 1, kind: "stats", refusalKind: "held", refusal: "Held by someone else" }, 1));
  const refused = show(refusal);
  assert.ok(refused.includes(refusal.title));
  assert.ok(refused.includes("Held by someone else"));
  assert.ok(refused.includes("Reason code: held"));
  assert.ok(!refused.includes(STATS_TEXT.empty));

  const error = fromAdapterError("stats", new Error("spawn branchling ENOENT"));
  assert.ok(show(error).includes(error.title));
  assert.ok(show(error).includes("spawn branchling ENOENT"));
});

// --- terminal capabilities --------------------------------------------------

test("colour is decided per stream: NO_COLOR, TERM=dumb and a non-TTY each turn it off", () => {
  const tty = { isTTY: true };
  const pipe = { isTTY: false };
  assert.equal(colourEnabled(tty, {}), true, "positive control");
  assert.equal(colourEnabled(tty, { NO_COLOR: "1" }), false);
  assert.equal(colourEnabled(tty, { NO_COLOR: "" }), true, "an empty NO_COLOR is not set");
  assert.equal(colourEnabled(tty, { TERM: "dumb" }), false);
  assert.equal(colourEnabled(pipe, {}), false);
  // stdout a terminal, stderr redirected: each stream answers for itself.
  assert.equal(colourEnabled(tty, { TERM: "xterm-256color" }), true);
  assert.equal(colourEnabled(pipe, { TERM: "xterm-256color" }), false);
});

test("the full screen needs both streams to be terminals and a TERM that is not dumb", () => {
  assert.equal(canDriveScreen({ stdin: fakeStdin(), stdout: fakeStdout(), env: {} }), true, "positive control");
  assert.equal(canDriveScreen({ stdin: fakeStdin(), stdout: fakeStdout(), env: { NO_COLOR: "1" } }), true, "NO_COLOR is about colour only");
  assert.equal(canDriveScreen({ stdin: fakeStdin(), stdout: fakeStdout(), env: { TERM: "dumb" } }), false);
  assert.equal(canDriveScreen({ stdin: fakeStdin({ isTTY: false }), stdout: fakeStdout(), env: {} }), false);
  assert.equal(canDriveScreen({ stdin: fakeStdin(), stdout: fakeStdout({ isTTY: false }), env: {} }), false);
});

// --- the loop over fake streams ---------------------------------------------

test("under NO_COLOR a terminal still gets the alternate screen, but no colour", async () => {
  const s = session({ adapter: okAdapter(), env: { NO_COLOR: "1" } });
  await tick();
  assert.ok(s.stdout.written.startsWith(ESC.altScreenOn + ESC.hideCursor));
  assert.equal(s.stdin.isRaw, true);
  assert.ok(visible(s.stdout.written).includes("Tasks 3"));
  assert.doesNotMatch(s.stdout.written, SGR_RE);
  s.stdin.emit("data", "q");
  assert.equal(await s.done, 0);
  assertRestored(s);

  // Positive control: the same run without NO_COLOR is coloured.
  const coloured = session({ adapter: okAdapter(), env: {} });
  await tick();
  assert.match(coloured.stdout.written, SGR_RE);
  coloured.stdin.emit("data", "q");
  await coloured.done;
});

test("TERM=dumb and a piped stdout print the screen once, with no escape code and no raw mode", async () => {
  for (const options of [{ env: { TERM: "dumb" } }, { stdoutTTY: false }, { stdinTTY: false, env: { NO_COLOR: "1" } }]) {
    const s = session({ adapter: okAdapter(), ...options });
    assert.equal(await s.done, 0);
    assert.doesNotMatch(s.stdout.written, /\x1b/, JSON.stringify(options));
    assert.ok(s.stdout.written.includes("Tasks 3"));
    assert.deepEqual(s.stdin.rawCalls, []);
  }
});

test("an exception while handling the answer restores the terminal", async () => {
  // A malformed envelope makes the view model throw: a bug, not a state.
  const s = session({ adapter: { stats: async () => ({ schemaVersion: 1, kind: "stats" }) } });
  assert.equal(await s.done, 1);
  assert.ok(s.stdout.written.startsWith(ESC.altScreenOn + ESC.hideCursor), "it had taken the screen");
  assert.deepEqual(s.stdin.rawCalls, [true, false]);
  assertRestored(s);
  assert.match(s.stderr.written, /TypeError: statsModel needs a stats envelope/);
});

test("an exception while rendering, on resize or on a key, restores the terminal", async () => {
  for (const trigger of [s => s.stdout.emit("resize"), s => s.stdin.emit("data", "r")]) {
    let explode = false;
    const render = (...args) => {
      if (explode) throw new Error("render failed");
      return renderScreen(...args);
    };
    const s = session({ adapter: okAdapter(), render });
    await tick();
    assert.equal(s.stdin.isRaw, true, "positive control: running before the fault");
    explode = true;
    trigger(s);
    assert.equal(await s.done, 1);
    assertRestored(s);
    assert.match(s.stderr.written, /render failed/);
  }
});

test("SIGINT, SIGTERM, Ctrl-C and an uncaught exception all restore the terminal, once", async () => {
  const cases = [
    [s => s.proc.emit("SIGINT"), 130],
    [s => s.proc.emit("SIGTERM"), 143],
    [s => s.stdin.emit("data", "\x03"), 130],
    [s => s.proc.emit("uncaughtException", new Error("elsewhere")), 1],
    [s => s.proc.emit("unhandledRejection", new Error("rejected")), 1],
  ];
  for (const [trigger, code] of cases) {
    const s = session({ adapter: okAdapter() });
    await tick();
    trigger(s);
    assert.equal(await s.done, code);
    // A second path firing afterwards changes nothing.
    s.proc.emit("exit");
    assertRestored(s);
    assert.equal(s.proc.listenerCount("SIGINT"), 0, "no listener left behind");
    assert.equal(s.stdout.listenerCount("resize"), 0);
  }
});

test("process exit while running restores the terminal synchronously", async () => {
  const s = session({ adapter: okAdapter() });
  await tick();
  s.proc.emit("exit", 0);
  assertRestored(s);
  s.stdin.emit("data", "q");
  await s.done;
  assertRestored(s);
});

test("resize redraws at the new width; r reads again and shows the last stats as stale meanwhile", async () => {
  const adapter = okAdapter();
  let release;
  const s = session({ adapter });
  await tick();
  assert.equal(adapter.calls, 1);

  s.stdout.columns = 40;
  const before = s.stdout.written.length;
  s.stdout.emit("resize");
  const redraw = s.stdout.written.slice(before).split("\r\n");
  for (const line of redraw) assert.ok(columns(line) <= 40, JSON.stringify(visible(line)));

  adapter.stats = () => new Promise(resolve => { adapter.calls++; release = () => resolve(envelope({ total: 5 })); });
  s.stdin.emit("data", "r");
  assert.equal(adapter.calls, 2);
  assert.ok(visible(s.stdout.written).includes("Showing the last known"), "stale while the read runs");
  release();
  await tick();
  assert.ok(visible(s.stdout.written.slice(s.stdout.written.lastIndexOf(ESC.home))).includes("Tasks 5"));
  s.stdin.emit("data", "q");
  assert.equal(await s.done, 0);
});

test("a refusal from the adapter is shown as a refusal on the full screen", async () => {
  const refusing = { stats: async () => { throw new BranchlingRefusal({ schemaVersion: 1, kind: "stats", refusalKind: "example-refusal", refusal: "declined for the test" }, 1); } };
  const s = session({ adapter: refusing });
  await tick();
  const screen = visible(s.stdout.written);
  assert.ok(screen.includes("branchling declined the request"));
  assert.ok(screen.includes("Reason code: example-refusal"));
  assert.ok(!screen.includes(STATS_TEXT.empty));
  s.stdin.emit("data", "q");
  assert.equal(await s.done, 0);
});

test("through the cache's join each refresh takes one scope, and its answeredAt() becomes the model's fetchedAt", async () => {
  const models = [];
  const render = (model, ...rest) => { models.push(model); return renderScreen(model, ...rest); };
  let scopes = 0;
  const served = {
    forRequest() {
      scopes++;
      let read = false;
      return { adapter: { stats: async () => { read = true; return envelope(); } }, answeredAt: () => (read ? 0 : null) };
    },
  };
  const s = session({ adapter: served, render });
  await tick();
  assert.equal(scopes, 1, "one scope for the first read");
  const ready = models.at(-1);
  assert.equal(ready.state, "ready");
  assert.equal(ready.freshness.fetchedAt, "1970-01-01T00:00:00.000Z");
  assert.equal(ready.freshness.stale, false, "a cache hit is never stale");
  s.stdin.emit("data", "r");
  assert.equal(scopes, 2, "a fresh scope per refresh");
  assert.equal(models.at(-1).freshness.stale, true, "in flight, the last answer is shown stale");
  assert.equal(models.at(-1).freshness.fetchedAt, "1970-01-01T00:00:00.000Z", "with the time it reflects");
  await tick();
  s.stdin.emit("data", "q");
  assert.equal(await s.done, 0);

  // A scope that made no cached read has no time: null, not the epoch.
  const timeless = session({ adapter: { forRequest: () => ({ adapter: { stats: async () => envelope() }, answeredAt: () => null }) }, render });
  await tick();
  assert.equal(models.at(-1).state, "ready");
  assert.equal(models.at(-1).freshness.fetchedAt, null);
  timeless.stdin.emit("data", "q");
  await timeless.done;

  // Positive control: a bare adapter's envelope has no answer time.
  const bare = [];
  const b = session({ adapter: okAdapter(), render: (model, ...rest) => { bare.push(model); return renderScreen(model, ...rest); } });
  await tick();
  assert.equal(bare.at(-1).state, "ready");
  assert.equal(bare.at(-1).freshness.fetchedAt, null);
  b.stdin.emit("data", "q");
  await b.done;
});

// --- against the real executable ----------------------------------------------

const BIN = process.env.BRANCHLING_BIN || "branchling";
const ENTRY = fileURLToPath(new URL("../bin/branchling-ui-tui.mjs", import.meta.url));
let root;
let dir;

async function branchling(args, opts = {}) {
  const at = opts.cwd || root;
  const { code, stderr } = await run(BIN, args, { cwd: at, env: fixtureEnv(at), ...opts });
  assert.equal(code, 0, `branchling ${args.join(" ")} exited ${code}: ${stderr}`);
}

const FIXTURE_BODY = JSON.stringify({
  goal: "A fixture task exists.",
  verification: [{ id: "noop", bash: "true", proves: "The fixture can be closed." }],
});

/** A git repository holding a backlog with two tasks, made by branchling itself. */
async function makeFixture(prefix) {
  const top = mkdtempSync(join(tmpdir(), prefix));
  const backlog = join(top, "backlog");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: top });
  await branchling(["init", "--dir", backlog, "--no-example", "--no-nudge"], { cwd: top });
  for (const [title, priority] of [["First fixture task", "P1"], ["Second fixture task", "P2"]]) {
    await branchling(["new", "--title", title, "--priority", priority, "--dir", backlog], { cwd: top, input: FIXTURE_BODY });
  }
  return { top, backlog };
}

before(async () => {
  ({ top: root, backlog: dir } = await makeFixture("branchling-ui-tui-"));
});

// Under a name filter that matches nothing here, node:test can run this hook
// without the `before` that sets `root` (UI-41).
after(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

test("the real stats envelope goes through the view model into an 80-column screen", async () => {
  const adapter = createAdapter({ bin: BIN, dir, cwd: root });
  const model = statsModel(await adapter.stats());
  assert.equal(model.state, "ready");
  const lines = renderScreen(model, { width: 80, height: 24, colour: false, keys: KEYS });
  for (const line of lines) assert.ok(columns(line) <= 80);
  const text = lines.join("\n");
  assert.doesNotMatch(text, /\x1b/);
  assert.ok(text.includes("Tasks 2"), text);
  assert.match(text, /^ {2}P1 +1$/m);
  assert.match(text, /^ {2}P2 +1$/m);

  // The same loop the entry point runs, over fake streams.
  const s = session({ adapter, env: { NO_COLOR: "1" } });
  await new Promise(resolve => setTimeout(resolve, 50));
  for (let i = 0; i < 100 && !visible(s.stdout.written).includes("Tasks 2"); i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(visible(s.stdout.written).includes("Tasks 2"));
  s.stdin.emit("data", "q");
  assert.equal(await s.done, 0);
  assertRestored(s);
});

test("the entry point prints the screen once, without escape codes, when piped", async () => {
  const env = { ...process.env };
  delete env.NO_COLOR;
  const { stdout, stderr, code } = await new Promise(resolve => {
    execFile(process.execPath, [ENTRY, "--dir", dir, "--bin", BIN], { cwd: root, env }, (err, out, errOut) => {
      resolve({ stdout: out, stderr: errOut, code: err ? err.code : 0 });
    });
  });
  assert.equal(code, 0, stderr);
  assert.doesNotMatch(stdout, /\x1b/);
  assert.ok(stdout.includes("Tasks 2"), stdout);
  assert.ok(stdout.includes(STATS_TEXT.byPriority));

  // Positive control: a directory with no backlog is an error screen and a failing exit.
  const missing = await new Promise(resolve => {
    execFile(process.execPath, [ENTRY, "--dir", join(root, "no-backlog-here"), "--bin", BIN], { cwd: root, env }, (err, out) => {
      resolve({ stdout: out, code: err ? err.code : 0 });
    });
  });
  assert.equal(missing.code, 1);
  assert.ok(missing.stdout.includes("The interface called branchling incorrectly"), missing.stdout);
});

// --- startup wiring (UI-20) ---------------------------------------------------

/** An executable that answers --version with `version` and nothing else. */
function fakeBin(where, version) {
  const file = join(where, process.platform === "win32" ? "fake-branchling.cmd" : "fake-branchling");
  if (process.platform === "win32") writeFileSync(file, `@if "%1"=="--version" (echo branchling ${version}) else (exit /b 1)\r\n`);
  else writeFileSync(file, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "branchling ${version}"; exit 0; fi\nexit 1\n`);
  chmodSync(file, 0o755);
  return file;
}

test("an unsupported branchling is warned about at startup, like the web entry, before the screen", async () => {
  const where = mkdtempSync(join(tmpdir(), "branchling-ui-tui-fake-"));
  try {
    const fake = fakeBin(where, "9.9.9");
    const warnings = [];
    const prepared = await prepareAdapter({ adapter: createAdapter({ bin: fake, dir, cwd: root }), dir, cwd: root, warn: m => warnings.push(m) });
    assert.equal(prepared.version, "9.9.9");
    assert.equal(prepared.supported, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /branchling 9\.9\.9 is outside the supported range/);

    // Positive control: the pinned executable is in range and gives no warning.
    const quiet = [];
    const real = await prepareAdapter({ adapter: createAdapter({ bin: BIN, dir, cwd: root }), dir, cwd: root, warn: m => quiet.push(m) });
    assert.equal(real.supported, true);
    assert.deepEqual(quiet, []);

    // Through the entry point: the warning is on stderr, the screen on stdout,
    // and the fake's failing stats read is an error screen and a failing exit.
    const { stdout, stderr, code } = await new Promise(resolve => {
      execFile(process.execPath, [ENTRY, "--dir", dir, "--bin", fake], { cwd: root }, (err, out, errOut) => {
        resolve({ stdout: out, stderr: errOut, code: err ? err.code : 0 });
      });
    });
    assert.match(stderr, /branchling 9\.9\.9 is outside the supported range/);
    assert.doesNotMatch(stdout, /outside the supported range/);
    assert.equal(code, 1);
  } finally {
    rmSync(where, { recursive: true, force: true });
  }
});

test("the TUI reads through the cache: an unchanged backlog is answered without a spawn, a change is read again", async () => {
  const fixture = await makeFixture("branchling-ui-tui-cache-");
  const shim = mkdtempSync(join(tmpdir(), "branchling-ui-tui-shim-"));
  try {
    // Spawns are counted at the spawn boundary, outside the repository.
    const counter = join(shim, "spawns");
    writeFileSync(counter, "");
    let countingBin;
    if (process.platform === "win32") {
      countingBin = join(shim, "counting-branchling.cmd");
      writeFileSync(countingBin, `@echo spawn>>"${counter}"\r\n@call "${BIN}" %*\r\n`);
    } else {
      countingBin = join(shim, "counting-branchling");
      writeFileSync(countingBin, `#!/bin/sh\necho spawn >> '${counter}'\nexec '${BIN}' "$@"\n`);
      chmodSync(countingBin, 0o755);
    }
    const spawns = () => readFileSync(counter, "utf8").split("\n").filter(Boolean).length;
    // A short racy window, so the test need not wait RACY_MS after each write.
    const RACY = 400;
    const settle = () => sleep(RACY + 150);
    const seen = [];
    const shortRacy = (adapter, options) => {
      seen.push(options);
      return createCache(adapter, { changes: createFileChanges({ ...options, racyMs: RACY }) });
    };
    await settle();

    const { adapter, cached } = await prepareAdapter({
      adapter: createAdapter({ bin: countingBin, dir: fixture.backlog, cwd: fixture.top }),
      dir: fixture.backlog,
      cwd: fixture.top,
      createCache: shortRacy,
    });
    assert.equal(cached, true);
    assert.equal(typeof adapter.forRequest, "function", "the cache comes through the server's join");
    assert.deepEqual(seen, [{ dir: fixture.backlog, cwd: fixture.top }], "the cache watches the directory the adapter reads");

    const models = [];
    const s = session({ adapter, env: { NO_COLOR: "1" }, render: (model, ...rest) => { models.push(model); return renderScreen(model, ...rest); } });
    const screenNow = () => visible(s.stdout.written.slice(s.stdout.written.lastIndexOf(ESC.home)));
    const waitFor = async text => {
      for (let i = 0; i < 200 && !(screenNow().includes(text) && !screenNow().includes(STATS_TEXT.stale)); i++) await sleep(25);
      assert.ok(screenNow().includes(text), screenNow());
    };
    await waitFor("Tasks 2");
    const afterFirst = spawns();
    const firstFetchedAt = models.at(-1).freshness.fetchedAt;
    assert.match(firstFetchedAt, /^\d{4}-\d\d-\d\dT/, "the scope's answeredAt() reaches the model");

    // Unchanged backlog: r is answered from memory, no process starts.
    s.stdin.emit("data", "r");
    await waitFor("Tasks 2");
    assert.equal(spawns(), afterFirst, "a refresh of an unchanged backlog spawns nothing");
    assert.equal(models.at(-1).freshness.fetchedAt, firstFetchedAt, "a hit keeps the time of the spawn that produced it");

    // Positive control: a change made by branchling itself is read again.
    await branchling(["new", "--title", "Third fixture task", "--priority", "P2", "--dir", fixture.backlog], { cwd: fixture.top, input: FIXTURE_BODY });
    await settle();
    s.stdin.emit("data", "r");
    await waitFor("Tasks 3");
    // Two reads, each one spawn: the screen's stats and the vocabulary its
    // colours come from (UI-18), which a change invalidates like any entry.
    assert.equal(spawns(), afterFirst + 2, "a changed backlog is read again, one spawn per read");

    s.stdin.emit("data", "q");
    assert.equal(await s.done, 0);
    assertRestored(s);

    // Without --dir the backlog branchling finds is the one the cache watches.
    seen.length = 0;
    const found = await prepareAdapter({
      adapter: createAdapter({ bin: BIN, cwd: fixture.top, env: { BACKLOG_DIR: null } }),
      cwd: fixture.top,
      createCache: shortRacy,
    });
    assert.equal(found.cached, true);
    assert.equal(seen.length, 1);
    assert.equal(realpathSync(seen[0].dir), realpathSync(fixture.backlog));
  } finally {
    rmSync(fixture.top, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});

test("without --dir the TUI takes the backlog root from one where, not from stats (UI-38)", async () => {
  const shimDir = mkdtempSync(join(tmpdir(), "branchling-ui-tui-argv-"));
  const outside = mkdtempSync(join(tmpdir(), "branchling-ui-tui-nobacklog-"));
  try {
    const shim = argvShim(shimDir, { bin: BIN });
    const env = { BACKLOG_DIR: null };
    const seen = [];
    const recordCache = (adapter, options) => { seen.push(options); return createCache(adapter, options); };
    const sub = join(root, "nested");
    mkdirSync(sub, { recursive: true });

    const found = await prepareAdapter({ adapter: createAdapter({ bin: shim.bin, cwd: sub, env }), cwd: sub, createCache: recordCache });
    assert.equal(found.cached, true);
    assert.equal(realpathSync(seen[0].dir), realpathSync(dir), "the root where names, found from a subdirectory");
    assert.deepEqual(shim.calls(), ["--version", "where --json"], "startup runs where, and no stats");

    // No backlog above the working directory: where answers backlog null,
    // so the TUI runs uncached and its first read shows the failure.
    const before = shim.calls().length;
    const none = await prepareAdapter({ adapter: createAdapter({ bin: shim.bin, cwd: outside, env }), cwd: outside, createCache: recordCache });
    assert.equal(none.cached, false);
    assert.equal(seen.length, 1, "no cache was made");
    assert.deepEqual(shim.calls().slice(before), ["--version", "where --json"]);
    await assert.rejects(none.adapter.stats());

    // With --dir nothing is asked: the directory given is the root.
    const given = shim.calls().length;
    const explicit = await prepareAdapter({ adapter: createAdapter({ bin: shim.bin, dir, cwd: root, env }), dir, cwd: root, createCache: recordCache });
    assert.equal(explicit.cached, true);
    assert.equal(seen[1].dir, dir);
    assert.deepEqual(shim.calls().slice(given), ["--version"]);
  } finally {
    rmSync(shimDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// --- the plan, release and decisions screens (UI-31) --------------------------

/** The last frame drawn on the full screen, as a terminal would show it. */
const lastFrame = stdout => visible(stdout.written.slice(stdout.written.lastIndexOf(ESC.home)));

async function until(check, what) {
  for (let i = 0; i < 200 && !check(); i++) await sleep(25);
  assert.ok(check(), what);
}

const VIEWS = ["plan", "release", "decisions"];
const SCREEN_TEXT = { plan: PLAN_TEXT, release: RELEASE_TEXT, decisions: DECISIONS_TEXT };
/** What each screen must show from its fixture: proof the model reached the lines. */
const EXPECTED = {
  plan: ["Wave 1 of 2: Foundation", "In flight (1)", "TASK-2  Walls stand", "May start now", "TASK-1  Foundation is laid", "Wave 2  Building  [next]", "waits on TASK-2", "Overtaken (1)", "Unplanned (1)", "TASK-5  A garden exists"],
  release: ["Computed from these refs", "web/staging", "web/production", "on the trunk, waiting for staging  1", "TASK-3", "in staging, waiting for production  1", "TASK-2", "in production  1", "counted, not listed"],
  decisions: ["2 open questions on 2 tasks", "Which database should the cache use?", DECISIONS_TEXT.needs, "branchling decide TASK-1 --resolves", "\"YOUR ANSWER\"", "Is the beta ready to ship?", "branchling decide TASK-2 --resolves", DECISIONS_TEXT.actorNote],
};

const fixtures = {};

before(async () => {
  const make = prefix => mkdtempSync(join(tmpdir(), prefix));
  fixtures.plan = await buildPlanBacklog(make("branchling-ui-tui-plan-"));
  fixtures.release = await buildReleaseBacklog(make("branchling-ui-tui-release-"));
  fixtures.decisions = await buildDecisionsBacklog(make("branchling-ui-tui-decisions-"));
  fixtures.empty = await buildEmptyBacklog(make("branchling-ui-tui-empty-"));
});

after(() => {
  for (const f of Object.values(fixtures)) rmSync(f.root, { recursive: true, force: true });
});

const realAdapter = name => createAdapter({ bin: BIN, dir: fixtures[name].dir, cwd: fixtures[name].root });

/** A screen's model from a real fixture, read the way the loop reads it. */
async function realModel(view, fixture = view) {
  const screen = screenById(view);
  return screen.model(await screen.read(realAdapter(fixture)), {}, Date.now());
}

test("every screen has a key on the key map, and the key map fits 80 columns", () => {
  assert.deepEqual(SCREENS.map(s => s.id), ["stats", ...VIEWS]);
  for (const screen of SCREENS) assert.equal(actionFor(screen.key), `screen:${screen.id}`, screen.id);
  assert.equal(actionFor("\t"), "next");
  assert.equal(actionFor("j"), "down");
  assert.equal(actionFor("k"), "up");
  assert.equal(actionFor("r"), "refresh");
  assert.equal(actionFor("q"), "quit");
  assert.equal(actionFor("x"), null, "a key not on the map does not exist");
  // Every input is shown: each entry with inputs is on the map line.
  const map = renderScreen(loadingState("plan"), { width: 80, height: 24, keys: KEYS }).at(-1);
  for (const k of KEYS) assert.ok(map.includes(`${k.key} ${k.label}`), k.key);
  assert.ok(columns(map) <= 80 && !map.includes("…"), "the whole key map fits 80 columns");
});

for (const view of VIEWS) {
  test(`the ${view} screen renders from the real view model at 80 columns, with no ANSI code under NO_COLOR`, async () => {
    const model = await realModel(view);
    assert.equal(model.view, view);
    assert.equal(model.state, "ready");
    for (const colour of [false, true]) {
      for (const lines of [renderScreen(model, { width: 80, colour }), renderScreen(model, { width: 80, height: 24, colour, keys: KEYS })]) {
        for (const line of lines) assert.ok(columns(line) <= 80, `${columns(line)} columns: ${JSON.stringify(visible(line))}`);
      }
    }
    const plain = renderScreen(model, { width: 80, colour: false });
    const text = plain.join("\n");
    assert.doesNotMatch(text, /\x1b/);
    // Positive control: the same model with colour on is coloured.
    assert.match(renderScreen(model, { width: 80, colour: true }).join("\n"), SGR_RE);
    assert.ok(plain[0].includes(screenById(view).title), "the header names the screen");
    for (const expected of EXPECTED[view]) assert.ok(text.includes(expected), `${expected} in\n${text}`);
    let at = -1;
    for (const expected of EXPECTED[view]) {
      const next = text.indexOf(expected, at);
      assert.ok(next >= at, `${expected} comes in the model's order`);
      at = next;
    }
    // Printed once, nothing is cut: no line ends in an ellipsis.
    assert.ok(plain.every(line => !line.endsWith("…")), text);
  });

  test(`the ${view} screen runs in the loop under NO_COLOR and leaves the terminal restored on q`, async () => {
    const s = session({ adapter: realAdapter(view), env: { NO_COLOR: "1" }, screen: view });
    await until(() => lastFrame(s.stdout).includes(EXPECTED[view][0]), `the ${view} screen is drawn`);
    assert.ok(s.stdout.written.startsWith(ESC.altScreenOn + ESC.hideCursor));
    assert.doesNotMatch(s.stdout.written, SGR_RE);
    for (const line of lastFrame(s.stdout).split("\r\n")) assert.ok(columns(line) <= 80);
    assert.equal(lastFrame(s.stdout).split("\r\n").length, 24, "exactly as high as the terminal");
    s.stdin.emit("data", "q");
    assert.equal(await s.done, 0);
    assertRestored(s);
  });

  test(`an exception while the ${view} screen is showing restores the terminal`, async () => {
    const triggers = [
      // A fault drawing this screen, reached by its key from the first screen.
      ["render", s => s.stdin.emit("data", screenById(view).key)],
      ["uncaught", s => s.proc.emit("uncaughtException", new Error(`${view} fault elsewhere`))],
      ["resize", s => { s.explode = true; s.stdout.emit("resize"); }],
    ];
    for (const [name, trigger] of triggers) {
      const box = {};
      const render = (model, ...rest) => {
        if (model.view === view && model.state === "ready" && (name === "render" || box.s?.explode)) throw new Error(`${view} render failed`);
        return renderScreen(model, ...rest);
      };
      const s = session({ adapter: realAdapter(view), render, screen: name === "render" ? "stats" : view });
      box.s = s;
      if (name !== "render") await until(() => lastFrame(s.stdout).includes(EXPECTED[view][0]), `${view} is showing`);
      else await until(() => lastFrame(s.stdout).includes("Tasks"), "stats is showing");
      assert.equal(s.stdin.isRaw, true, "positive control: running before the fault");
      trigger(s);
      assert.equal(await s.done, 1, name);
      assertRestored(s);
      assert.match(s.stderr.written, new RegExp(`${view} (render failed|fault elsewhere)`), name);
    }
  });

  test(`a malformed answer on the ${view} screen never leaves the terminal changed`, async () => {
    const malformed = {
      stats: async () => envelope(),
      plan: async () => ({ schemaVersion: 1, kind: "plan" }),
      query: async () => ({ schemaVersion: 1, kind: "task-list", tasks: [] }),
      deployStatus: async () => ({ schemaVersion: 1, kind: "release-status" }),
      log: async () => ({ schemaVersion: 1, kind: "task-log", exchanges: [] }),
    };
    if (view === "decisions") {
      // listDecisions refuses an entry it cannot use as a contract mismatch.
      malformed.openQuestions = async () => ({ schemaVersion: 1, kind: "open-questions", questions: [{ task: "-x" }] });
    }
    const s = session({ adapter: malformed, screen: view, env: { NO_COLOR: "1" } });
    if (view === "decisions") {
      // A contract mismatch from the adapter is an error screen, not a crash.
      await until(() => lastFrame(s.stdout).includes("The installed branchling is not a supported version"), "error screen");
      s.stdin.emit("data", "q");
      assert.equal(await s.done, 0);
    } else {
      assert.equal(await s.done, 1);
      assert.match(s.stderr.written, new RegExp(`TypeError: ${view}Model needs`));
    }
    assertRestored(s);
  });

  test(`the ${view} screen has its loading, empty, error, refusal and stale states, none of them coloured under NO_COLOR`, async () => {
    const text = SCREEN_TEXT[view];
    const refusal = fromAdapterError(view, new BranchlingRefusal({ schemaVersion: 1, kind: "x", refusalKind: "held", refusal: "Held for the test" }, 1));
    const error = fromAdapterError(view, new Error("spawn branchling ENOENT"));
    const empty = await realModel(view, "empty");
    assert.equal(empty.state, "empty");
    const ready = await realModel(view);
    const stale = screenById(view).model(await screenById(view).read(realAdapter(view)), { stale: true }, Date.now());
    const show = model => renderScreen(model, { width: 80, height: 24, keys: KEYS }).join("\n");

    assert.ok(show(loadingState(view)).includes(text.loading));
    assert.ok(show(stale).includes(text.stale));
    assert.ok(!show(ready).includes(text.stale), "positive control: fresh is not stale");
    const refused = show(refusal);
    assert.ok(refused.includes("branchling declined the request") && refused.includes("Held for the test") && refused.includes("Reason code: held"));
    assert.ok(show(error).includes("spawn branchling ENOENT"));
    const emptyText = { plan: PLAN_TEXT.emptyNoPlan, release: "No deploy targets", decisions: DECISIONS_TEXT.empty }[view];
    const flat = text => text.replace(/\s+/g, " ");
    assert.ok(flat(show(empty)).includes(flat(emptyText)), show(empty));
    assert.ok(!flat(refused).includes(flat(emptyText)), "a refusal is never the empty screen");
    for (const model of [loadingState(view), empty, ready, stale, refusal, error]) {
      const lines = renderScreen(model, { width: 80, height: 24, keys: KEYS, colour: false });
      assert.doesNotMatch(lines.join("\n"), /\x1b/, model.state);
      for (const line of lines) assert.ok(columns(line) <= 80, JSON.stringify(line));
      assert.match(renderScreen(model, { width: 80, height: 24, keys: KEYS, colour: true }).join("\n"), SGR_RE, `${model.state}: colour on`);
    }
  });

  test(`the entry point prints the ${view} screen once, without escape codes, when piped`, async () => {
    const env = { ...process.env };
    delete env.NO_COLOR;
    const { stdout, stderr, code } = await new Promise(resolve => {
      execFile(process.execPath, [ENTRY, "--dir", fixtures[view].dir, "--bin", BIN, "--screen", view], { cwd: fixtures[view].root, env }, (err, out, errOut) => {
        resolve({ stdout: out, stderr: errOut, code: err ? err.code : 0 });
      });
    });
    assert.equal(code, 0, stderr);
    assert.doesNotMatch(stdout, /\x1b/);
    for (const expected of EXPECTED[view]) assert.ok(stdout.includes(expected), `${expected} in\n${stdout}`);
    for (const line of stdout.split("\n")) assert.ok(columns(line) <= 80, line);
  });
}

test("the decisions screen shows how to answer with branchling decide, never with --actor", async () => {
  const model = await realModel("decisions");
  const text = renderScreen(model, { width: 80 }).join("\n");
  for (const q of model.questions) {
    // The command is broken with a shell continuation, never cut: joined again it is the model's command.
    const joined = text.replace(/ \\\n +/g, " ");
    assert.ok(joined.includes(q.commands.reason), `${q.commands.reason} in\n${text}`);
    assert.match(q.commands.reason, new RegExp(`^branchling decide ${q.taskId} --resolves ${q.questionId} --reason `));
  }
  assert.doesNotMatch(text, /--actor/);
  assert.ok(text.includes(DECISIONS_TEXT.howToAnswer.split(" ").slice(0, 4).join(" ")));
  // Positive control: at a width the command does not fit, it is continued, not cut.
  const narrow = renderScreen(model, { width: 60 });
  assert.ok(narrow.some(line => line.endsWith(" \\")), narrow.join("\n"));
  assert.ok(narrow.every(line => columns(line) <= 60));
});

test("keys switch screens, tab cycles through them, and switching back shows the last answer stale while it is read again", async () => {
  let releasePlan = null;
  const adapter = {
    calls: { stats: 0, plan: 0 },
    stats: async () => { adapter.calls.stats++; return envelope(); },
    plan: () => { adapter.calls.plan++; return releasePlan ? new Promise(r => { const go = releasePlan; releasePlan = () => r(go()); }) : realAdapter("plan").plan(); },
    // The plan fixture has no question: its decisions screen is the empty one.
    query: () => realAdapter("plan").query(),
    log: (id, o) => realAdapter("plan").log(id, o),
    openQuestions: () => realAdapter("plan").openQuestions(),
    deployStatus: () => realAdapter("release").deployStatus(),
  };
  const s = session({ adapter, env: { NO_COLOR: "1" } });
  const title = () => lastFrame(s.stdout).split("\r\n")[0];
  await until(() => lastFrame(s.stdout).includes("Tasks 3"), "stats first");
  assert.ok(title().startsWith(`branchling-ui  ${screenById("stats").title}`));

  s.stdin.emit("data", "2");
  await until(() => lastFrame(s.stdout).includes(EXPECTED.plan[0]), "2 shows the plan");
  assert.ok(title().startsWith(`branchling-ui  ${PLAN_TEXT.title}`));
  s.stdin.emit("data", "3");
  await until(() => lastFrame(s.stdout).includes("web/production"), "3 shows the release pipeline");
  assert.ok(title().startsWith(`branchling-ui  ${RELEASE_TEXT.title}`));
  s.stdin.emit("data", "4");
  await until(() => title().startsWith(`branchling-ui  ${DECISIONS_TEXT.title}`) && lastFrame(s.stdout).includes(DECISIONS_TEXT.empty), "4 shows the decisions");
  s.stdin.emit("data", "\t");
  await until(() => title().startsWith(`branchling-ui  ${screenById("stats").title}`), "tab after the last screen comes back to the first");
  s.stdin.emit("data", "x");
  assert.ok(title().startsWith(`branchling-ui  ${screenById("stats").title}`), "a key not on the map changes nothing");

  // Back to the plan: its last answer is on screen, stale, until the new read lands.
  let held;
  releasePlan = () => held;
  const realPlan = await realAdapter("plan").plan();
  held = realPlan;
  const before = adapter.calls.plan;
  s.stdin.emit("data", "\t");
  assert.equal(adapter.calls.plan, before + 1, "switching to a screen reads it again");
  assert.ok(lastFrame(s.stdout).includes(PLAN_TEXT.stale), "the last plan, marked stale, while the read runs");
  assert.ok(lastFrame(s.stdout).includes(EXPECTED.plan[0]));
  releasePlan();
  await until(() => !lastFrame(s.stdout).includes(PLAN_TEXT.stale), "fresh again once it lands");
  releasePlan = null;

  s.stdin.emit("data", "q");
  assert.equal(await s.done, 0);
  assertRestored(s);
});

test("a screen taller than the terminal scrolls with j and k and says which lines it shows", async () => {
  const model = await realModel("plan");
  const rows = 12;
  const full = renderScreen(model, { width: 80 }).length - 2;
  assert.ok(full > rows, "positive control: the plan is taller than the terminal");
  const top = renderScreen(model, { width: 80, height: rows, keys: KEYS });
  assert.equal(top.length, rows);
  assert.match(top.at(-2), /lines 1-8 of \d+ · j down/);
  const limit = maxScroll(model, { width: 80, height: rows });
  assert.ok(limit > 0);
  const bottom = renderScreen(model, { width: 80, height: rows, keys: KEYS, offset: limit + 50 });
  assert.match(bottom.at(-2), new RegExp(`lines ${limit + 1}-${full} of ${full} · k up`), "clamped at the end");
  assert.ok(bottom.join("\n").includes(PLAN_TEXT.footnote.split(" ").slice(0, 4).join(" ")), "the end is reachable");

  const s = session({ adapter: realAdapter("plan"), env: { NO_COLOR: "1" }, screen: "plan", rows });
  await until(() => lastFrame(s.stdout).includes(EXPECTED.plan[0]), "the plan is showing");
  s.stdin.emit("data", "j");
  assert.match(lastFrame(s.stdout), /lines 2-9 of/);
  s.stdin.emit("data", "kkkk");
  assert.match(lastFrame(s.stdout), /lines 1-8 of/, "k stops at the top");
  s.stdin.emit("data", "j".repeat(limit + 20));
  assert.match(lastFrame(s.stdout), new RegExp(`lines ${limit + 1}-${full} of ${full}`), "j stops at the bottom");
  s.stdin.emit("data", "q");
  assert.equal(await s.done, 0);
  assertRestored(s);
});
