/**
 * The terminal interface (UI-16). The renderer is a pure function, tested on
 * hand-built models; the loop runs over fake streams and a fake process, so
 * the tests assert on the exact bytes written and on the raw-mode state; the
 * last tests feed the REAL branchling executable, over a fixture backlog in a
 * temporary directory, through the adapter and the view model into the
 * renderer and through the entry point.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { BranchlingRefusal, createAdapter, run } from "../src/adapter.mjs";
import { STATS_TEXT, statsModel } from "../src/view-model/stats.mjs";
import { fromAdapterError, loadingState } from "../src/view-model/states.mjs";
import { KEYS, renderScreen } from "../src/tui/render.mjs";
import { ESC, canDriveScreen, colourEnabled } from "../src/tui/terminal.mjs";
import { runTui } from "../src/tui/app.mjs";

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
function session({ adapter, env = {}, stdinTTY = true, stdoutTTY = true, render, columns = 80, rows = 24 } = {}) {
  const stdin = fakeStdin({ isTTY: stdinTTY });
  const stdout = fakeStdout({ isTTY: stdoutTTY, columns, rows });
  const stderr = fakeStdout({ isTTY: false });
  const proc = new EventEmitter();
  const done = runTui({ adapter, stdin, stdout, stderr, proc, env, ...(render ? { render } : {}) });
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
    assert.equal(lines.at(-1), "q quit  r refresh");
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

// --- against the real executable ----------------------------------------------

const BIN = process.env.BRANCHLING_BIN || "branchling";
const ENTRY = fileURLToPath(new URL("../bin/branchling-ui-tui.mjs", import.meta.url));
let root;
let dir;

async function branchling(args, opts) {
  const { code, stderr } = await run(BIN, args, { cwd: root, ...opts });
  assert.equal(code, 0, `branchling ${args.join(" ")} exited ${code}: ${stderr}`);
}

before(async () => {
  root = mkdtempSync(join(tmpdir(), "branchling-ui-tui-"));
  dir = join(root, "backlog");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  await branchling(["init", "--dir", dir, "--no-example", "--no-nudge"]);
  for (const [title, priority] of [["First fixture task", "P1"], ["Second fixture task", "P2"]]) {
    const body = JSON.stringify({
      goal: "A fixture task exists.",
      verification: [{ id: "noop", bash: "true", proves: "The fixture can be closed." }],
    });
    await branchling(["new", "--title", title, "--priority", priority, "--dir", dir], { input: body });
  }
});

after(() => {
  rmSync(root, { recursive: true, force: true });
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
