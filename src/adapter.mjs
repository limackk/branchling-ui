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

function run(bin, args, { cwd, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(resolveBin(bin), args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
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
    deployStatus: () => json(["deploy", "status"], "release-status"),

    /** Escape hatch for commands without a typed wrapper yet. */
    raw: json,
  };
}
