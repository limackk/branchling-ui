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

export function createAdapter({ dir, bin, cwd } = {}) {
  const withDir = args => (dir ? [...args, "--dir", dir] : args);

  async function json(args, expectedKind, opts = {}) {
    const full = withDir([...args, "--json"]);
    const { code, stdout, stderr } = await run(bin, full, { cwd, input: opts.input });
    if (!stdout.trim()) throw new BranchlingUsageError(full, code, stderr);
    const envelope = parseEnvelope(stdout, expectedKind);
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
    plan: () => json(["plan"], "plan"),
    show: id => json(["show", id], "task-show"),
    log: id => json(["log", id], "task-log"),
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

    /** Escape hatch for commands without a typed wrapper yet. */
    raw: json,
  };
}
