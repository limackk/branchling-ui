/**
 * The only door into branchling.
 *
 * WHY A SUBPROCESS AND NOT AN IMPORT. branchling has no plugin API by design
 * (its fourth law): the extension surface is `--json` on every reading command
 * and a callable input on every writing one. Its `scripts/` modules are an
 * implementation, not a library, and importing them would couple this package
 * to every internal refactor. Spawning the installed executable binds us to the
 * one contract its maintainers promise to keep, the JSON envelope:
 *
 *   { "schemaVersion": 1, "kind": "<kind>", ...keys declared for that kind }
 *
 * A refusal is not a separate kind: it is the requested kind with
 * `refusalKind` set and a non-zero exit. A usage error (unknown flag, value
 * outside the vocabulary) prints no envelope at all, only text on stderr.
 *
 * No other module in this package may spawn branchling or read a backlog file.
 */

import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";

/** Envelope versions this package understands. A new version is a code change
 *  here, never a silent best effort: a renamed key reads as a missing value. */
export const SUPPORTED_SCHEMA_VERSIONS = [1];

/** The executable releases this package is tested against: [min, maxExclusive).
 *  0.3.0 is the first published release with `show` and `deploy` (UI-14). */
export const SUPPORTED_RANGE = { min: "0.3.0", maxExclusive: "0.4.0" };

export class BranchlingUsageError extends Error {
  constructor(args, code, stderr) {
    super(`branchling ${args.join(" ")} exited ${code}: ${stderr.trim()}`);
    this.name = "BranchlingUsageError";
    this.code = code;
    this.stderr = stderr;
  }
}

export class BranchlingRefusal extends Error {
  constructor(envelope, code) {
    super(envelope.refusal || envelope.refusalKind);
    this.name = "BranchlingRefusal";
    this.code = code;
    this.envelope = envelope;
  }
}

export class ContractMismatch extends Error {
  constructor(message) {
    super(message);
    this.name = "ContractMismatch";
  }
}

function resolveBin(bin) {
  return bin || process.env.BRANCHLING_BIN || "branchling";
}

/**
 * WINDOWS. npm installs a bin there as a `.cmd` shim, and a `.cmd` file can
 * only be started by cmd.exe: `execFile` neither searches PATHEXT nor runs a
 * batch file without a shell. A shell would then parse the arguments, and
 * they carry task ids and filter values a user typed, so `shell: true` with
 * Node's own joining is an injection path. Instead the shim is found here and
 * the cmd.exe command line is built with every argument quoted for the C
 * runtime and every cmd.exe metacharacter caret-escaped TWICE: once for the
 * `cmd /c` line and once more because a batch file re-parses `%*` when it
 * runs the line that forwards it. This is the scheme cross-spawn uses for npm
 * shims, written out so the package keeps no runtime dependency.
 */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** One argument as the Microsoft C runtime will split it back out. */
export function quoteWindowsArg(arg) {
  let out = '"';
  let slashes = 0;
  for (const ch of String(arg)) {
    if (ch === "\\") { slashes++; continue; }
    out += "\\".repeat(ch === '"' ? slashes * 2 + 1 : slashes) + ch;
    slashes = 0;
  }
  return out + "\\".repeat(slashes * 2) + '"';
}

/** The full cmd.exe command line that starts a batch file with these args. */
export function cmdLineForBatch(file, args) {
  const meta = s => s.replace(CMD_META, "^$1");
  return [meta(file), ...args.map(a => meta(meta(quoteWindowsArg(a))))].join(" ");
}

function whichWindows(command) {
  const exts = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const names = extname(command) ? [command] : exts.map(ext => command + ext);
  const dirs = /[\\/]/.test(command) ? [""] : (process.env.PATH || "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = dir ? join(dir, name) : name;
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function spawnTarget(command, args) {
  if (process.platform !== "win32") return { file: command, args, options: {} };
  const found = whichWindows(command);
  if (!found || !/\.(cmd|bat)$/i.test(found)) return { file: found || command, args, options: {} };
  return {
    file: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", `"${cmdLineForBatch(found, args)}"`],
    options: { windowsVerbatimArguments: true },
  };
}

/** `env` over this process's environment; a key given as null or undefined is removed. */
function mergeEnv(env) {
  const out = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === null) delete out[key];
    else out[key] = String(value);
  }
  return out;
}

/**
 * Starts the executable and collects its output. Exported for the test
 * fixtures, which have to start branchling exactly the way the adapter does.
 * `env` is merged over this process's environment; the fixtures use it to give
 * branchling a private data and config home, so a fixture's reservations and
 * telemetry never land in the user's own directories. A key given as `null`
 * or `undefined` is removed from the child's environment (a test of the
 * default actor drops `BACKLOG_ACTOR` that way).
 */
export function run(bin, args, { cwd, input, env } = {}) {
  const target = spawnTarget(resolveBin(bin), args);
  return new Promise((resolve, reject) => {
    const options = { cwd, maxBuffer: 64 * 1024 * 1024, ...(env ? { env: mergeEnv(env) } : {}), ...target.options };
    const child = execFile(target.file, target.args, options, (err, stdout, stderr) => {
      if (err && typeof err.code !== "number") { reject(err); return; }
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

/** The events a `change-stream` envelope may carry (branchling 0.3.0 `follow --json`). */
export const CHANGE_STREAM_EVENTS = Object.freeze(["ready", "change", "heartbeat"]);
/** The `change` values of a `change` event. */
export const CHANGE_KINDS = Object.freeze(["created", "modified", "deleted"]);
/** The longest line `follow` may print before it is a ContractMismatch, not a buffer. */
export const MAX_STREAM_LINE = 1024 * 1024;

/**
 * One line of `follow --json` as a checked `change-stream` envelope, or a
 * ContractMismatch. Measured on branchling 0.3.0, every line is
 *
 *   { schemaVersion: 1, kind: "change-stream", event: "ready"|"change"|"heartbeat",
 *     at: <ISO>, root: <backlog dir>, id, file, change, fields: [] }
 *
 * with `id`, `file` and `change` null except on `change`, where `id` is the
 * task id, `change` one of CHANGE_KINDS and `fields` the frontmatter fields
 * that moved (`__body__` for the markdown body).
 */
export function parseChangeLine(line) {
  const envelope = parseEnvelope(line, "change-stream");
  if (!CHANGE_STREAM_EVENTS.includes(envelope.event)) throw new ContractMismatch(`change-stream event "${envelope.event}" is not one of ${CHANGE_STREAM_EVENTS.join(", ")}`);
  if (!Array.isArray(envelope.fields) || !envelope.fields.every(f => typeof f === "string")) throw new ContractMismatch("change-stream envelope has no fields list");
  if (envelope.event === "change") {
    if (typeof envelope.id !== "string" || !envelope.id) throw new ContractMismatch("change-stream change names no task id");
    if (!CHANGE_KINDS.includes(envelope.change)) throw new ContractMismatch(`change-stream change "${envelope.change}" is not one of ${CHANGE_KINDS.join(", ")}`);
  }
  return envelope;
}

/**
 * Stops a long-running child started through `spawnTarget`, and everything
 * it started. The npm bin is a launcher: `branchling follow` is node running
 * the bin, which runs `scripts/follow-changes.mjs` as ITS child and does not
 * pass SIGTERM on (measured on 0.3.0). Killing the pid alone orphaned the
 * watcher, which kept the stdout pipe, and with it the server, open. So on
 * POSIX the child is started as a process-group leader (`detached`) and the
 * signal goes to the group; on Windows (cmd.exe running a `.cmd` shim, then
 * node) the tree goes with `taskkill /T`. A group still there after
 * `graceMs` is killed.
 */
function signalTree(child, signal) {
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
    return;
  }
  try { process.kill(-child.pid, signal); } catch { /* the group is gone */ }
}

function stopTree(child, graceMs = 2000) {
  if (!child.pid) return;
  signalTree(child, "SIGTERM");
  if (process.platform === "win32") return;
  const timer = setTimeout(() => signalTree(child, "SIGKILL"), graceMs);
  timer.unref();
  child.once("close", () => clearTimeout(timer));
}

/**
 * `branchling follow --json`: a long-running child that prints one
 * `change-stream` envelope per line (see parseChangeLine). The ONLY streaming
 * call; every other call is one spawn, one envelope.
 *
 * Returns a handle, an EventEmitter:
 *
 *   "envelope"  (envelope)          a checked envelope: ready, change, heartbeat
 *   "mismatch"  (ContractMismatch)  a line that is not one; the stream goes on
 *   "exit"      ({ code, signal, stderr, error })  exactly once, when the child
 *               is gone (error: it could not be started at all)
 *
 *   handle.pid       the child's pid, a process-group leader on POSIX (the
 *                    cmd.exe shim's on Windows); branchling's watcher is
 *                    its child, so kill the group (-pid), not the pid
 *   handle.close()   stops the child; resolves once it has exited
 *
 * A line is never a crash: the handle has no "error" event, so a listener
 * cannot be forgotten. Exit codes, from `follow --help`: 0 stopped (signal,
 * reader gone, --max-events reached), 1 the watch could not be set up, 2 a
 * usage error. Deciding what an exit means (restart, give up) is the
 * caller's (src/live.mjs).
 */
function followStream(bin, args, { cwd, env } = {}) {
  const target = spawnTarget(resolveBin(bin), args);
  const handle = new EventEmitter();
  let child;
  let exited = false;
  let stderr = "";
  let rest = "";
  const done = new Promise(resolvePromise => handle.once("exit", resolvePromise));
  const finish = info => {
    if (exited) return;
    exited = true;
    handle.emit("exit", { code: null, signal: null, stderr, error: null, ...info });
  };
  const line = text => {
    if (!text.trim()) return;
    try {
      handle.emit("envelope", parseChangeLine(text));
    } catch (err) {
      handle.emit("mismatch", err instanceof ContractMismatch ? err : new ContractMismatch(String(err && err.message || err)));
    }
  };
  try {
    child = spawn(target.file, target.args, {
      cwd, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
      ...(env ? { env: mergeEnv(env) } : {}), ...target.options,
    });
  } catch (error) {
    queueMicrotask(() => finish({ error }));
    handle.pid = null;
    handle.close = () => done;
    return handle;
  }
  handle.pid = child.pid ?? null;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    rest += chunk;
    let nl;
    while ((nl = rest.indexOf("\n")) !== -1) {
      line(rest.slice(0, nl));
      rest = rest.slice(nl + 1);
    }
    if (rest.length > MAX_STREAM_LINE) {
      handle.emit("mismatch", new ContractMismatch(`a change-stream line is longer than ${MAX_STREAM_LINE} bytes`));
      rest = "";
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-4096); });
  child.on("error", error => { if (child.pid === undefined) finish({ error }); });
  // The launcher gone, its watcher must not stay behind holding the pipe.
  child.on("exit", () => { if (!exited) stopTree(child); });
  child.on("close", (code, signal) => {
    if (rest.trim()) line(rest);
    rest = "";
    finish({ code, signal });
  });
  handle.close = () => {
    if (!exited) stopTree(child);
    return done;
  };
  return handle;
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/**
 * Parses an envelope and checks the two keys every consumer may rely on.
 * `expectedKind` guards against a command whose output changed shape under us.
 */
export function parseEnvelope(text, expectedKind) {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new ContractMismatch("output is not JSON: " + text.slice(0, 200));
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new ContractMismatch("output is not an envelope object");
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(envelope.schemaVersion)) {
    throw new ContractMismatch(`schemaVersion ${envelope.schemaVersion} is not one of ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}`);
  }
  if (expectedKind && envelope.kind !== expectedKind) {
    throw new ContractMismatch(`expected kind "${expectedKind}", got "${envelope.kind}"`);
  }
  return envelope;
}

/** How many `log` calls `listDecisions()` keeps running at once. */
export const DECISIONS_CONCURRENCY = 4;

/** `items` mapped through the async `fn`, at most `limit` at a time, in order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Every open question in the backlog, as ONE answer.
 *
 * branchling 0.2 has no single command that lists open questions across
 * tasks (an upstream gap, UI-23). An open question is defined by branchling as
 * a question no decision points at, computed from each task's log, so this
 * reads `query` once (the active tasks, branchling's own default scope, no
 * status named) and then `log <ID> --decisions` for each of them,
 * DECISIONS_CONCURRENCY at a time. Any failure rejects the whole answer, never
 * a shorter list.
 *
 * It takes an adapter-shaped object rather than being a method, so the reads
 * it makes are that object's: given the server's per-request scope, every
 * `query` and `log` goes through UI-2's cache like any other read, and the
 * response's X-Branchling-UI-Fetched-At covers them. As a method it would be
 * one opaque call the cache treats as a write. It spawns nothing itself.
 *
 * `log --decisions` keeps a `question` message only while it is open
 * (answered ones are left out; see `branchling log --help`), so a task is
 * listed when its log holds at least one. The answer is composed here, so its
 * `kind` is this package's, `decisions`:
 *
 *   { kind: "decisions", composed: true, scanned: <tasks whose log was read>,
 *     tasks: [{ task: <the task's row from query, unchanged>,
 *               log:  <its task-log envelope, unchanged> }] }
 *
 * The view model (src/view-model/decisions.mjs) turns that into questions.
 *
 * @param {{ query: Function, log: Function }} adapter
 */
export async function listDecisions(adapter) {
  const list = await adapter.query();
  const rows = Array.isArray(list.tasks) ? list.tasks : [];
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !row.id || row.id.startsWith("-")) throw new ContractMismatch("query returned a task without a usable id");
  }
  const logs = await mapLimit(rows, DECISIONS_CONCURRENCY, row => adapter.log(row.id, { decisions: true }));
  const tasks = [];
  rows.forEach((row, i) => {
    const exchanges = Array.isArray(logs[i].exchanges) ? logs[i].exchanges : [];
    const open = exchanges.some(x => Array.isArray(x.messages) && x.messages.some(m => m && m.kind === "question"));
    if (open) tasks.push({ task: row, log: logs[i] });
  });
  return { kind: "decisions", composed: true, scanned: rows.length, tasks };
}

/**
 * Everything the task panel (UI-27) shows about one task, as ONE answer.
 *
 * branchling 0.2 spreads it over three reads, and this composes them the way
 * listDecisions composes its own, from an adapter-shaped object, so each read
 * goes through the server's per-request scope and UI-2's cache:
 *
 *   show <ID>                         status, priority, title, file, blockers
 *                                     and branchling's `blocked` verdict. First,
 *                                     because its `no-such-task` refusal is the
 *                                     panel's not-found state, and it names the
 *                                     status the row is looked up by
 *   log <ID>                          the history, one exchange per write
 *   query --text <ID> --status <s>    the task's row: the fields `show` does not
 *                                     carry (owner, epic, labels, estimate…).
 *                                     `--text` is a substring of "<id> <title>",
 *                                     so the row is picked by its exact id. The
 *                                     status `show` gave lets a closed task's row
 *                                     be found too
 *   query --blocked-by <ID>           the tasks this one blocks (active ones,
 *                                     branchling's default scope)
 *   set --fields                      the fields `set` edits, as data (TL-543):
 *                                     which pens the panel draws, in
 *                                     branchling's order. Lifted to `fields`:
 *                                     the array, or null from a build that
 *                                     cannot describe them (see `setFields`)
 *
 * No read prints the body (`show` leaves it out on purpose), so there is no
 * `body` key; see src/view-model/task.mjs. Any failure rejects the whole
 * answer, never a smaller one.
 *
 *   { kind: "task-panel", composed: true, id, show, log, task: <row>|null, blocks: [<row>],
 *     fields: [{ name, list, clearable, vocabulary, suggestions, values }]|null }
 *
 * @param {{ show: Function, log: Function, query: Function }} adapter
 * @param {string} id a task id, already checked by the caller
 */
export async function readTask(adapter, id) {
  if (typeof id !== "string" || !id || id.startsWith("-")) throw new BranchlingUsageError(["show", String(id)], 2, "a task id is required");
  const show = await adapter.show(id);
  const status = typeof show.status === "string" && /^[A-Za-z0-9_][A-Za-z0-9_ -]*$/.test(show.status) ? show.status : null;
  const [log, list, blocking, described] = await Promise.all([
    adapter.log(id),
    adapter.query(status ? { text: id, status } : { text: id }),
    adapter.query({ "blocked-by": id }),
    adapter.setFields(),
  ]);
  const rows = Array.isArray(list.tasks) ? list.tasks : [];
  const task = rows.find(t => t && t.id === id) || null;
  const blocks = (Array.isArray(blocking.tasks) ? blocking.tasks : []).filter(t => t && typeof t.id === "string" && t.id);
  const fields = described ? described.fields : null;
  return { kind: "task-panel", composed: true, id, show, log, task, blocks, fields };
}

/**
 * What a recorded `decide --json` must carry beyond the envelope, or it is a
 * ContractMismatch rather than a success with nothing in it. Measured on
 * branchling 0.3.0, `decide` prints the envelope every other command prints:
 *
 *   { schemaVersion: 1, kind: "task-decide", ok, id,
 *     decision: { id, ts, text, actor, resolves, chose } | null,
 *     chosen, openQuestions, lifted, refusalKind, refusal, details }
 *
 * A refusal sets `refusalKind` and exits 1 (`unknown-event`, `option-range`)
 * or 2 (`not-found`); a malformed `--resolves` is a usage error, stderr only.
 * (0.2.x printed a bare object with no schemaVersion, which parseEnvelope now
 * refuses; that range is no longer supported.)
 */
function acceptDecision(envelope) {
  if (envelope.ok !== true || typeof envelope.id !== "string" || !envelope.decision || typeof envelope.decision.id !== "string") {
    throw new ContractMismatch("task-decide answered success without a recorded decision");
  }
  return envelope;
}

/**
 * The kinds whose non-zero exit can be an ANSWER rather than a refusal, and
 * the exit each one may answer a failing verdict with.
 *
 * WHY. Every other command exits non-zero only to refuse, so `json()` throws
 * BranchlingRefusal for any non-zero exit. `doctor` and `check` are verdicts:
 * a broken backlog makes them exit non-zero WITH a normal envelope
 * (`ok: false`, no `refusalKind`), because CI reads the exit code. For a view
 * that failing verdict is the data it exists to show. So these two kinds,
 * and only these, accept it (measured on branchling 0.2.0, unchanged in 0.3.0):
 *
 *   doctor  exit 1 with `ok: false`: some check has status `error` (also when
 *           `--dir` is not a backlog: `root: null` and one `backlog` check)
 *   check   exit = the worst guard's exit (>= 1) with `ok: false` and the
 *           failing guards' names in `failed` (since branchling TL-541, also
 *           when `--dir` is not a backlog: `root: null`, `failed: ["backlog"]`
 *           and one `backlog` guard; before it, stdout was empty and the
 *           call was a BranchlingUsageError)
 *
 * `ok` must agree with the exit code either way: `ok: true` with a non-zero
 * exit, or `ok: false` with exit 0, is a shape this package does not know and
 * fails as a ContractMismatch rather than being guessed at. A refusal
 * (`refusalKind` set) still throws.
 */
export const VERDICT_KINDS = Object.freeze({
  doctor: (envelope, code) => code === 1,
  check: (envelope, code) => code >= 1 && Array.isArray(envelope.failed) && envelope.failed.length > 0,
});

/** A `doctor` or `check` envelope checked against its exit code (see VERDICT_KINDS). */
export function acceptVerdict(envelope, code) {
  const failingExit = VERDICT_KINDS[envelope.kind];
  if (!failingExit) throw new ContractMismatch(`"${envelope.kind}" is not a verdict kind`);
  if (envelope.refusalKind) throw new BranchlingRefusal(envelope, code);
  if (typeof envelope.ok !== "boolean") throw new ContractMismatch(`${envelope.kind} envelope has no boolean ok`);
  if (envelope.ok === true && code === 0) return envelope;
  if (envelope.ok === false && code !== 0 && failingExit(envelope, code)) return envelope;
  throw new ContractMismatch(`${envelope.kind} answered ok: ${envelope.ok} with exit ${code}`);
}

const stringOrNull = v => v === null || (typeof v === "string" && v !== "");

/** One entry of `set --fields --json` as TL-543 shipped it; anything else is not guessed at. */
function isSetFieldDescription(f) {
  return Boolean(f) && typeof f === "object" && !Array.isArray(f)
    && typeof f.name === "string" && /^[a-z][a-z0-9_]*$/.test(f.name)
    && typeof f.list === "boolean" && typeof f.clearable === "boolean"
    && stringOrNull(f.vocabulary) && stringOrNull(f.suggestions)
    && (f.values === null || (Array.isArray(f.values) && f.values.every(v => typeof v === "string")));
}

/**
 * A value a writing call puts on branchling's argv: a non-empty string that
 * cannot be read as a flag. Checked here as well as by the route, so no
 * caller of the adapter can smuggle `--take-over` or `--actor` in as a value.
 */
function argWord(base, name, value) {
  if (typeof value !== "string" || !value.trim()) throw new BranchlingUsageError(base, 2, `${name} is required`);
  if (value.startsWith("-")) throw new BranchlingUsageError(base, 2, `${name} cannot start with "-": branchling would read it as a flag`);
  return value;
}

/**
 * `opts.env` is merged over this process's environment for every spawn (see
 * `run`). The server passes none: branchling then sees the environment of the
 * person who started it, `$BACKLOG_ACTOR` included. Tests use it to give
 * branchling a private state, data and config home and a known actor.
 */
export function createAdapter({ dir, bin, cwd, env } = {}) {
  const withDir = args => (dir ? [...args, "--dir", dir] : args);
  /** Learned once: the executable refuses `set --fields` (a build before TL-543). */
  let setFieldsFlagUnknown = false;

  /**
   * `opts.verdict`: the command is one of VERDICT_KINDS, whose failing answer
   * exits non-zero with a normal envelope. Every other call keeps the rule
   * that a non-zero exit is a refusal.
   *
   * `opts.literal`: words passed after `--`, at the very end, so branchling
   * reads each as a positional even when it starts with "-". Only for a
   * command whose parser has the terminator (`set` since 0.3.0).
   */
  async function json(args, expectedKind, opts = {}) {
    const flagged = withDir([...args, "--json"]);
    const full = opts.literal ? [...flagged, "--", ...opts.literal] : flagged;
    const { code, stdout, stderr } = await run(bin, full, { cwd, input: opts.input, env });
    if (!stdout.trim()) throw new BranchlingUsageError(full, code, stderr);
    const envelope = parseEnvelope(stdout, expectedKind);
    if (opts.verdict) return acceptVerdict(envelope, code);
    if (code !== 0 || envelope.refusalKind) throw new BranchlingRefusal(envelope, code);
    return envelope;
  }

  return {
    /** The executable's version, checked against SUPPORTED_RANGE. */
    async version() {
      const { code, stdout, stderr } = await run(bin, ["--version"], { cwd, env });
      if (code !== 0) throw new BranchlingUsageError(["--version"], code, stderr);
      const match = stdout.match(/(\d+\.\d+\.\d+)/);
      if (!match) throw new ContractMismatch("unrecognised --version output: " + stdout.trim());
      const v = match[1];
      const supported = compareVersions(v, SUPPORTED_RANGE.min) >= 0 && compareVersions(v, SUPPORTED_RANGE.maxExclusive) < 0;
      return { version: v, supported };
    },

    /**
     * `query` with its filters as `{status: "pending,blocked", epic: "…"}`.
     *
     * `scope` (`active`, `archived`, `all`) is `--scope` (TL-540), and the
     * envelope names the set it searched in `scope`. A different answer is a
     * ContractMismatch: an executable that ignored the flag would hand back
     * the active set, which reads exactly like a correct archived list. Only
     * an asked-for scope is judged, so a call without one keeps working
     * against a branchling whose envelope has no `scope` key.
     */
    async query(filters = {}) {
      const args = ["query"];
      for (const [key, value] of Object.entries(filters)) args.push("--" + key, String(value));
      const envelope = await json(args, "task-list");
      if (filters.scope !== undefined && envelope.scope !== String(filters.scope)) {
        throw new ContractMismatch(`query was asked for scope ${filters.scope} and answered ${JSON.stringify(envelope.scope)}`);
      }
      return envelope;
    },

    stats: () => json(["stats"], "stats"),
    /**
     * `vocabulary`: the words config.yaml declares, in declared order (UI-18,
     * upstream TL-532). Measured on branchling main after TL-532:
     *
     *   { schemaVersion: 1, kind: "vocabulary", root,
     *     statuses: [{ name, archived, reasonRequired, role, roleSource }],
     *     priorities: [string], types, confidence, estimates, labels,
     *     labels_closed, boards: [{ slug, name, isDefault }], roles,
     *     releases, deploy_targets }
     *
     * `role` is one of open, active, waiting, closed, cancelled. Only
     * `statuses` and `priorities` are checked here, because they are what a
     * view reads; a status without a name, a role or an archived flag, or a
     * priority that is not a name, is a ContractMismatch rather than an
     * uncoloured row.
     *
     * Resolves to `null` when the executable has no `vocabulary` command:
     * branchling 0.3.0, the published floor of SUPPORTED_RANGE, predates it,
     * and answers `unknown command: vocabulary` on stderr with exit 2. Inside
     * the supported range that is an answer ("this build cannot say"), not a
     * bug of this package, so it is not a BranchlingUsageError; the views then
     * keep the neutral palette. `null` is "not known", never "empty". Any
     * other usage error still throws.
     */
    async vocabulary() {
      let envelope;
      try {
        envelope = await json(["vocabulary"], "vocabulary");
      } catch (err) {
        if (err instanceof BranchlingUsageError && err.code === 2 && /unknown command:?\s*vocabulary\b/.test(err.stderr || "")) return null;
        throw err;
      }
      const { statuses, priorities } = envelope;
      if (!Array.isArray(statuses) || !statuses.every(s => s && typeof s.name === "string" && s.name && typeof s.role === "string" && typeof s.archived === "boolean")) {
        throw new ContractMismatch("vocabulary answered statuses without a name, a role or an archived flag");
      }
      if (!Array.isArray(priorities) || !priorities.every(p => typeof p === "string" && p)) {
        throw new ContractMismatch("vocabulary answered priorities that are not names");
      }
      return envelope;
    },
    /**
     * `where`: the backlog this run would read and the rule that found it,
     * plus this machine's branchling homes. Measured on branchling 0.3.0:
     *
     *   { schemaVersion: 1, kind: "where", home, homeSource, config, data,
     *     preferences: { path, exists }, agentProfiles: { path, exists },
     *     backlog: { root, source } | null, error: string | null }
     *
     * `source` is `explicit` (--dir), `env`, `discovery` or `colocated`. No
     * backlog found (nothing above the working directory, or a `--dir` that is
     * not a backlog) is NOT a refusal: exit 0, `backlog: null` and the reason
     * in `error`. So this call returns that answer, and a caller that needs a
     * root reads `backlog` and shows `error` when it is null. A bad flag is
     * exit 2, stderr only: a BranchlingUsageError. It creates nothing.
     *
     * `backlog` that is neither null nor an object with a string `root`
     * is a shape this package does not know, so a ContractMismatch.
     */
    async where() {
      const envelope = await json(["where"], "where");
      const { backlog } = envelope;
      if (backlog !== null && !(backlog && typeof backlog.root === "string" && backlog.root)) {
        throw new ContractMismatch("where answered a backlog without a root");
      }
      if (backlog === null && typeof envelope.error !== "string") {
        throw new ContractMismatch("where answered no backlog and no error");
      }
      return envelope;
    },
    /**
     * `doctor`: the setup checks (`ok`, `root`, `next`, `checks[]` of `id`,
     * `title`, `status`, `detail`, `fix`). A failing verdict is returned, not
     * thrown (VERDICT_KINDS).
     */
    doctor: () => json(["doctor"], "doctor", { verdict: true }),
    /**
     * Bare `check`: the release gate (`ok`, `root`, `failed`, `guards[]` of
     * `name`, `severity`, `ok`, `exit`, `output`, and `skipped` for a guard
     * not run). A failing verdict is returned, not thrown. No selector is
     * passed: the bare command is the verdict a release gets.
     */
    check: () => json(["check"], "check", { verdict: true }),
    plan: () => json(["plan"], "plan"),
    show: id => json(["show", id], "task-show"),
    /** `log <ID>`; `{ decisions: true }` adds `--decisions` (what is decided and what is still open). */
    log: (id, { decisions = false } = {}) => json(decisions ? ["log", id, "--decisions"] : ["log", id], "task-log"),
    /**
     * `deploy status`, optionally for one target (`--target`) or compared with
     * one planned release (`--release`). An undeclared target or release is
     * a refusal envelope, exit 1 (TL-533): `refusalKind: "unknown-name"`,
     * `rejected: { flag, value }` and `declared` (what that flag accepts, []
     * when nothing is), so a BranchlingRefusal, never an empty pipeline. A
     * flag that does not exist or lacks its value stays exit 2, stderr only.
     */
    async deployStatus({ target, release } = {}) {
      const args = ["deploy", "status"];
      for (const [flag, value] of [["--target", target], ["--release", release]]) {
        if (value === undefined || value === null || value === "") continue;
        // A value that looks like a flag would be read as one (`--release --count`).
        if (String(value).startsWith("-")) throw new BranchlingUsageError([...args, flag, String(value)], 2, `${flag} takes a name, not a flag`);
        args.push(flag, String(value));
      }
      return json(args, "release-status");
    },

    /**
     * `decide <id> --resolves <event id> (--choose <n> | --reason "…") [--actor <ns:name>]`.
     *
     * `actor` is passed only when the caller states one. The server never does:
     * branchling then resolves the actor itself (`$BACKLOG_ACTOR`, then the
     * user's own config, then its default). Values are an argv array, never a
     * shell string; a value starting with "-" would be read as a flag, so it is
     * refused here before branchling sees it.
     */
    async decide({ id, resolves, choose, reason, actor } = {}) {
      const base = ["decide"];
      const bad = message => new BranchlingUsageError([...base, String(id)], 2, message);
      const word = (name, value) => {
        if (typeof value !== "string" || !value.trim()) throw bad(`${name} is required`);
        if (value.startsWith("-")) throw bad(`${name} cannot start with "-": branchling would read it as a flag`);
        return value;
      };
      const args = [...base, word("the task id", id), "--resolves", word("--resolves", resolves)];
      const hasChoose = choose !== undefined && choose !== null;
      const hasReason = reason !== undefined && reason !== null;
      if (hasChoose === hasReason) throw bad("exactly one of --choose and --reason is required");
      if (hasChoose) {
        if (!Number.isInteger(choose) || choose < 1) throw bad("--choose takes a positive whole number");
        args.push("--choose", String(choose));
      } else {
        args.push("--reason", word("--reason", reason));
      }
      if (actor !== undefined && actor !== null && actor !== "") args.push("--actor", word("--actor", actor));
      return acceptDecision(await json(args, "task-decide"));
    },

    /*
     * The task panel's writes (UI-30): `take`, `release` and `handoff`. None
     * takes an actor: branchling resolves it itself ($BACKLOG_ACTOR, then the
     * user's config, then its default), and the envelope (or the history)
     * says whom it recorded. None passes `--take-over`, `--probe`, `--role`,
     * `--status`, `--with` or `--to-owner`: the panel offers none of them.
     * Every value is an argv element, never a shell string, and one starting
     * with "-" is refused before branchling runs (argWord).
     *
     * How each one fails, measured on branchling 0.3.0:
     *   take     every failure is an envelope, so a BranchlingRefusal: exit 1
     *            `other-owner` (held), `closed` (a closed task); exit 2
     *            `not-found` (no such task)
     *   release  exit 1 `other-owner`, exit 2 `not-found`, both envelopes.
     *            A missing --reason is exit 2 with `refusalKind: "usage"`,
     *            which argWord makes unreachable from here
     *   handoff  exit 1 `other-owner` (an envelope). An undeclared role, a
     *            backlog with no `roles:`, and a missing --reason are exit 2
     *            with stderr only: a BranchlingUsageError, which the route
     *            turns into 422 rejected-input for the role that was typed
     */

    /** `take <ID>`: reserve the task and set it in progress (`task-take`). */
    async take(id) {
      const base = ["take"];
      return json([...base, argWord(base, "the task id", id)], "task-take");
    },

    /** `release <ID> --reason "…"`: give the task back to the queue (`task-release`). */
    async release(id, { reason } = {}) {
      const base = ["release"];
      return json([...base, argWord(base, "the task id", id), "--reason", argWord(base, "--reason", reason)], "task-release");
    },

    /** `handoff <ID> --to-role <r> --reason "…"`: hand the task to a role (`task-handoff`). */
    async handoff(id, { role, reason } = {}) {
      const base = ["handoff"];
      return json([
        ...base, argWord(base, "the task id", id),
        "--to-role", argWord(base, "--to-role", role),
        "--reason", argWord(base, "--reason", reason),
      ], "task-handoff");
    },

    /**
     * `set <ID> <field> <value> [--reason "…"] [--actor <ns:name>]`: one field
     * of one task, validated by branchling against config.yaml and recorded
     * in the task's history (`task-set`, UI-6). 0.3.0 is the first release
     * that has it.
     *
     * Measured on branchling 0.3.0, every answer is an envelope:
     *
     *   { schemaVersion: 1, kind: "task-set", ok, id, file, field,
     *     value (a string, or an array for a list field), actor,
     *     changes: [{ id, ts, task, field, from, to, actor, source: "set", reason }],
     *     refusalKind, refusal, details }
     *
     * `changes` is empty when the value was already that. Every failure is a
     * refusal envelope, so a BranchlingRefusal: `dedicated` (status and
     * owner: take, done, handoff, release and ask own them), `not-found` (no
     * such task), `reason-required` (a reason the backlog demands), and
     * `usage` for a field `set` does not edit, an empty value for a field
     * that may not be empty, a reserved reason (`unknown`, `proven`). A value
     * outside the field's vocabulary is `unknown-value` (TL-543, exit 1) with
     * `rejected: { field, value }` and `declared`, the values it accepts; a
     * build before TL-543 refuses it as `usage`, its text naming the same.
     *
     * `value` may be empty: an empty value clears a field that may be empty;
     * a list field takes its items comma-separated. The id, the field and the
     * value go after `--` (branchling 0.3.0 has the terminator), so a value
     * that starts with "-", a title "-x", is set as written; the id, the field,
     * the reason and the actor are still names and words that may not.
     * `actor` is passed only when the caller states one; the server never
     * does.
     */
    async set(id, field, value, { reason, actor } = {}) {
      const base = ["set"];
      const literal = [argWord(base, "the task id", id), argWord(base, "the field", field)];
      if (typeof value !== "string") throw new BranchlingUsageError(base, 2, "the value must be a string (empty clears the field)");
      literal.push(value);
      const args = [...base];
      if (reason !== undefined && reason !== null && reason !== "") args.push("--reason", argWord(base, "--reason", reason));
      if (actor !== undefined && actor !== null && actor !== "") args.push("--actor", argWord(base, "--actor", actor));
      const envelope = await json(args, "task-set", { literal });
      if (envelope.ok !== true || typeof envelope.id !== "string" || typeof envelope.field !== "string" || !Array.isArray(envelope.changes)) {
        throw new ContractMismatch("task-set answered success without the field it set");
      }
      return envelope;
    },

    /**
     * `set --fields`: the fields `set` edits, as data (`task-set-fields`,
     * TL-543), so the panel draws a pen for exactly those and never keeps a
     * list of its own that could fall behind the executable:
     *
     *   { schemaVersion: 1, kind: "task-set-fields", root,
     *     fields: [{ name, list, clearable, vocabulary, suggestions, values }] }
     *
     * `vocabulary` is the config.yaml key a value must come from, or null;
     * `suggestions` a key whose values are offered but not enforced, or null;
     * `values` a vocabulary the tool fixes itself (executor), or null.
     *
     * TL-543 is merged upstream after the 0.3.0 release, whose `set` answers
     * the flag with a `task-set` refusal (`usage`, "unknown flag: --fields",
     * exit 2). That refusal, and only that one, means "this build cannot
     * describe its fields": the answer is null, which the panel shows as "no
     * field edits with this build" rather than guessing a list, and it is
     * remembered for the life of the adapter, so an older build costs one
     * spawn per adapter, not one per panel. Any other failure throws, and a
     * field that is not of the shape above is a ContractMismatch.
     */
    async setFields() {
      if (setFieldsFlagUnknown) return null;
      let envelope;
      try {
        envelope = await json(["set", "--fields"], null);
      } catch (err) {
        const refused = err instanceof BranchlingRefusal ? err.envelope : null;
        if (!refused || refused.kind !== "task-set" || refused.refusalKind !== "usage" || !/unknown flag: --fields\b/.test(String(refused.refusal))) throw err;
        setFieldsFlagUnknown = true;
        return null;
      }
      if (envelope.kind !== "task-set-fields") throw new ContractMismatch(`expected kind "task-set-fields", got "${envelope.kind}"`);
      if (!Array.isArray(envelope.fields) || !envelope.fields.every(isSetFieldDescription)) {
        throw new ContractMismatch("task-set-fields answered a field that is not { name, list, clearable, vocabulary, suggestions, values }");
      }
      return envelope;
    },

    /**
     * `declare releases <name> --reason "…" [--ref <ref>]`: append one release
     * to `releases:` in config.yaml, the reason written as a comment above it
     * (`vocabulary-declare`, UI-8). 0.3.0 is the first release that has it.
     * branchling edits the file; this package never does.
     *
     * Measured on branchling 0.3.0, every answer is an envelope:
     *
     *   { schemaVersion: 1, kind: "vocabulary-declare", ok, key, name,
     *     entry: { name, ref } | null, reason, file,
     *     refusalKind, refusal, details }
     *
     * and every failure a BranchlingRefusal: exit 1 `duplicate` (a name
     * already declared; changing an entry stays a hand edit); exit 2
     * `malformed` (not a lowercase slug, a ref that is not one ref name),
     * `usage` (no name, an empty --reason, an unknown flag, not a backlog)
     * and `undeclared-key` (a key no command writes).
     *
     * Only `releases` is wrapped. `deploy_targets` takes a repository, or
     * repeatable `--stage <n>=<ref>[,<ref>]` and `--paths`, which nothing in
     * this package offers yet; it is refused here, before a spawn, rather
     * than passed through half-built. The reason is required here as well as
     * by branchling, and no value may start with "-" (argWord): branchling
     * has no `--` and would read it as a flag, and 0.3.0 writes a `--ref`
     * of `-x` to config.yaml as given.
     */
    async declare(key, name, { reason, ref } = {}) {
      const base = ["declare"];
      if (key !== "releases") throw new BranchlingUsageError(base, 2, `declare ${String(key)} is not wrapped: only releases is`);
      const args = [...base, key, argWord(base, "the release name", name), "--reason", argWord(base, "--reason", reason)];
      if (ref !== undefined && ref !== null && ref !== "") args.push("--ref", argWord(base, "--ref", ref));
      const envelope = await json(args, "vocabulary-declare");
      if (envelope.ok !== true || envelope.key !== key || typeof envelope.name !== "string" || !envelope.entry || typeof envelope.entry !== "object") {
        throw new ContractMismatch("vocabulary-declare answered success without the entry it wrote");
      }
      return envelope;
    },

    /**
     * `follow --json [--heartbeat <s>] [--max-events <n>]`: the change stream
     * (UI-7). Returns the handle `followStream` describes, not a promise. The
     * server keeps one per backlog (src/live.mjs); nothing caches it.
     */
    follow({ heartbeat, maxEvents } = {}) {
      const args = ["follow", "--json"];
      for (const [flag, value] of [["--heartbeat", heartbeat], ["--max-events", maxEvents]]) {
        if (value === undefined || value === null) continue;
        if (!Number.isInteger(value) || value < 0) throw new BranchlingUsageError(["follow", flag, String(value)], 2, `${flag} takes a whole number of 0 or more`);
        args.push(flag, String(value));
      }
      return followStream(bin, withDir(args), { cwd, env });
    },

    /** Escape hatch for commands without a typed wrapper yet. */
    raw: json,
  };
}
