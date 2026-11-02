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

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";

/** Envelope versions this package understands. A new version is a code change
 *  here, never a silent best effort: a renamed key reads as a missing value. */
export const SUPPORTED_SCHEMA_VERSIONS = [1];

/** The executable releases this package is tested against: [min, maxExclusive). */
export const SUPPORTED_RANGE = { min: "0.2.0", maxExclusive: "0.3.0" };

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

/**
 * Starts the executable and collects its output. Exported for the test
 * fixtures, which have to start branchling exactly the way the adapter does.
 * `env` is merged over this process's environment; the fixtures use it to give
 * branchling a private data and config home, so a fixture's reservations and
 * telemetry never land in the user's own directories.
 */
export function run(bin, args, { cwd, input, env } = {}) {
  const target = spawnTarget(resolveBin(bin), args);
  return new Promise((resolve, reject) => {
    const options = { cwd, maxBuffer: 64 * 1024 * 1024, ...(env ? { env: { ...process.env, ...env } } : {}), ...target.options };
    const child = execFile(target.file, target.args, options, (err, stdout, stderr) => {
      if (err && typeof err.code !== "number") { reject(err); return; }
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
  });
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
 *
 * No read prints the body (`show` leaves it out on purpose), so there is no
 * `body` key; see src/view-model/task.mjs. Any failure rejects the whole
 * answer, never a smaller one.
 *
 *   { kind: "task-panel", composed: true, id, show, log, task: <row>|null, blocks: [<row>] }
 *
 * @param {{ show: Function, log: Function, query: Function }} adapter
 * @param {string} id a task id, already checked by the caller
 */
export async function readTask(adapter, id) {
  if (typeof id !== "string" || !id || id.startsWith("-")) throw new BranchlingUsageError(["show", String(id)], 2, "a task id is required");
  const show = await adapter.show(id);
  const status = typeof show.status === "string" && /^[A-Za-z0-9_][A-Za-z0-9_ -]*$/.test(show.status) ? show.status : null;
  const [log, list, blocking] = await Promise.all([
    adapter.log(id),
    adapter.query(status ? { text: id, status } : { text: id }),
    adapter.query({ "blocked-by": id }),
  ]);
  const rows = Array.isArray(list.tasks) ? list.tasks : [];
  const task = rows.find(t => t && t.id === id) || null;
  const blocks = (Array.isArray(blocking.tasks) ? blocking.tasks : []).filter(t => t && typeof t.id === "string" && t.id);
  return { kind: "task-panel", composed: true, id, show, log, task, blocks };
}

/**
 * Reads what `branchling decide --json` prints.
 *
 * WHY NOT parseEnvelope. In the supported range (0.2.x) `decide --json` does
 * not print the envelope every other command prints: there is no
 * `schemaVersion` and no `kind` of its own. A recorded decision is
 *
 *   { ok: true, id, decision: { id, ts, text, actor, resolves, chose }, chosen, openQuestions, lifted }
 *
 * and a refusal is `{ ok: false, kind: "<refusal kind>", id, message, details }`
 * with a non-zero exit (1, or 2 for an unknown task). That is an upstream gap,
 * reported, not a shape to guess around: this function accepts exactly those
 * two shapes, turns the second into a BranchlingRefusal whose envelope carries
 * `refusalKind` and `refusal` as everywhere else (the text unchanged), and
 * fails loudly with ContractMismatch on anything else, including a future
 * `decide` that prints a real envelope, so that change is a deliberate edit
 * here and not a silent best effort.
 */
export function parseDecideOutput(text, code) {
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    throw new ContractMismatch("decide output is not JSON: " + text.slice(0, 200));
  }
  if (!out || typeof out !== "object" || Array.isArray(out)) throw new ContractMismatch("decide output is not an object");
  if ("schemaVersion" in out) {
    throw new ContractMismatch("decide now prints an envelope (schemaVersion " + out.schemaVersion + "); the adapter reads only the 0.2 shape and must be updated");
  }
  if (out.ok === true && code === 0 && typeof out.id === "string" && out.decision && typeof out.decision.id === "string") {
    return out;
  }
  if (out.ok === false && code !== 0 && typeof out.kind === "string" && typeof out.message === "string") {
    throw new BranchlingRefusal({
      kind: "decide",
      ok: false,
      id: typeof out.id === "string" ? out.id : null,
      refusalKind: out.kind,
      refusal: out.message,
      details: Array.isArray(out.details) ? out.details.map(String) : [],
    }, code);
  }
  throw new ContractMismatch(`decide output has an unexpected shape (exit ${code}): ` + text.slice(0, 200));
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
 * and only these, accept it (measured on branchling 0.2.0):
 *
 *   doctor  exit 1 with `ok: false`: some check has status `error` (also when
 *           `--dir` is not a backlog: `root: null` and one `backlog` check)
 *   check   exit = the worst guard's exit (>= 1) with `ok: false` and the
 *           failing guards' names in `failed`
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

export function createAdapter({ dir, bin, cwd } = {}) {
  const withDir = args => (dir ? [...args, "--dir", dir] : args);

  /**
   * `opts.verdict`: the command is one of VERDICT_KINDS, whose failing answer
   * exits non-zero with a normal envelope. Every other call keeps the rule
   * that a non-zero exit is a refusal.
   */
  async function json(args, expectedKind, opts = {}) {
    const full = withDir([...args, "--json"]);
    const { code, stdout, stderr } = await run(bin, full, { cwd, input: opts.input });
    if (!stdout.trim()) throw new BranchlingUsageError(full, code, stderr);
    const envelope = parseEnvelope(stdout, expectedKind);
    if (opts.verdict) return acceptVerdict(envelope, code);
    if (code !== 0 || envelope.refusalKind) throw new BranchlingRefusal(envelope, code);
    return envelope;
  }

  return {
    /** The executable's version, checked against SUPPORTED_RANGE. */
    async version() {
      const { code, stdout, stderr } = await run(bin, ["--version"], { cwd });
      if (code !== 0) throw new BranchlingUsageError(["--version"], code, stderr);
      const match = stdout.match(/(\d+\.\d+\.\d+)/);
      if (!match) throw new ContractMismatch("unrecognised --version output: " + stdout.trim());
      const v = match[1];
      const supported = compareVersions(v, SUPPORTED_RANGE.min) >= 0 && compareVersions(v, SUPPORTED_RANGE.maxExclusive) < 0;
      return { version: v, supported };
    },

    /** `query` with its filters as `{status: "pending,blocked", epic: "…"}`. */
    query(filters = {}) {
      const args = ["query"];
      for (const [key, value] of Object.entries(filters)) args.push("--" + key, String(value));
      return json(args, "task-list");
    },

    stats: () => json(["stats"], "stats"),
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
     * one planned release (`--release`). An undeclared target or release is a
     * usage error from branchling (no envelope), never an empty pipeline.
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
      const full = withDir([...args, "--json"]);
      const { code, stdout, stderr } = await run(bin, full, { cwd });
      if (!stdout.trim()) throw new BranchlingUsageError(full, code, stderr);
      return parseDecideOutput(stdout, code);
    },

    /** Escape hatch for commands without a typed wrapper yet. */
    raw: json,
  };
}
