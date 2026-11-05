/**
 * The health view model (UI-28): plain data computed from a `doctor`
 * envelope (the setup checks), a `check` envelope (the release gate) and,
 * optionally, a `stats` envelope (its `divergent` list: tasks another branch
 * or worktree disagrees with).
 *
 * Pure and portable like stats.mjs: no `node:` import, no DOM, no HTML, no
 * ANSI, no I/O. Both surfaces render THIS.
 *
 * BRANCHLING SAID IT, WE SHOW IT. Every sentence about a check is
 * branchling's own, unchanged: doctor's `title`, `detail`, `fix` and `next`,
 * check's guard `name`, `severity` and `output` (several lines, with
 * branchling's own ✓ ✗ · marks). The model decides only what branchling
 * leaves to its reader: the result label, the order (failures first), the
 * counts, the badge number and the headline.
 *
 * A FAILING CHECK IS DATA. A broken backlog is the answer this view exists
 * for, so a failing verdict is `state: "ready"` with `verdict: "fail"`,
 * never the error state. The adapter returns it (VERDICT_KINDS in
 * src/adapter.mjs) instead of throwing.
 *
 * WHY RESULTS GET A FIXED COLOUR ROLE when a status's role is read. A status
 * is a value out of the backlog's own config.yaml, which this package may not
 * read, so its colour comes from the role the `vocabulary` envelope gives it
 * (UI-18, roles.mjs), never from its name, and is neutral when that envelope
 * is not known. A check's result is not vocabulary: doctor's `status`
 * (ok, info, warn, error) and a guard's `ok` and `skipped` are branchling's
 * own verdict, fixed by the tool and the same in every backlog. So it is
 * mapped here, with no envelope to wait for:
 *
 *   fail     doctor `error`, a guard with `ok: false`   danger
 *   warn     doctor `warn`                              attention
 *   info     doctor `info`                              neutral
 *   pass     doctor `ok`, a guard with `ok: true`       success
 *   not-run  a guard with `skipped: true`               muted
 *
 * A doctor status this package does not know is shown as branchling wrote
 * it, `neutral`, and counted as neither passing nor failing. A guard that was
 * not run is its own state: it neither passed nor failed, because the
 * question was never asked. The label is always shown; colour is never the
 * only signal.
 */

/** The sentences and headings of the health view, decided once for both surfaces. */
export const HEALTH_TEXT = {
  title: "Health",
  lede: "Is the backlog set up correctly, and would a release pass its gate?",
  runAgain: "Run again",
  doctorTitle: "Setup checks",
  doctorCommand: "branchling doctor",
  doctorLoading: "Running the setup checks…",
  doctorEmpty: "branchling reported no setup checks.",
  checkTitle: "Release gate",
  checkCommand: "branchling check",
  checkLoading: "Running the release gate…",
  checkEmpty: "branchling ran no guards.",
  noBacklog: "branchling found no backlog where it looked.",
  divergentTitle: "Changed on other branches",
  divergentCommand: "branchling stats",
  divergentLoading: "Looking at other branches…",
  divergentEmpty: "No other branch or worktree disagrees with a task here.",
  divergentNotScanned: "Other branches were not scanned.",
  stale: "Showing the last known results; a fresh run is on its way.",
  next: "Next",
  fix: "What to do",
  severity: "Severity",
  badgeLabel: "failing checks",
};

const RESULTS = {
  fail: { label: "fails", role: "danger", rank: 0 },
  warn: { label: "warning", role: "attention", rank: 1 },
  info: { label: "note", role: "neutral", rank: 2 },
  unknown: { label: null, role: "neutral", rank: 3 },
  pass: { label: "passes", role: "success", rank: 4 },
  "not-run": { label: "not run", role: "muted", rank: 5 },
};

const DOCTOR_RESULT = { error: "fail", warn: "warn", info: "info", ok: "pass" };

function freshnessOf(freshness = {}) {
  return { stale: freshness.stale === true, fetchedAt: freshness.fetchedAt ?? null };
}

const text = value => (typeof value === "string" && value.trim() ? value : null);

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Failures first, then warnings, notes, passes and what was not run; branchling's order within each. */
function byResult(rows) {
  return rows
    .map((row, i) => [row, i])
    .sort(([a, i], [b, j]) => RESULTS[a.result].rank - RESULTS[b.result].rank || i - j)
    .map(([row]) => row);
}

function countsOf(rows) {
  const counts = { total: rows.length, fail: 0, warn: 0, info: 0, unknown: 0, pass: 0, notRun: 0 };
  for (const row of rows) counts[row.result === "not-run" ? "notRun" : row.result]++;
  return counts;
}

/**
 * @param {object} envelope a `doctor` envelope from adapter.doctor()
 * @param {{ stale?: boolean, fetchedAt?: string|null }} [freshness]
 */
export function doctorModel(envelope, freshness = {}) {
  if (!envelope || envelope.kind !== "doctor" || !Array.isArray(envelope.checks) || typeof envelope.ok !== "boolean") {
    throw new TypeError("doctorModel needs a doctor envelope");
  }
  const rows = envelope.checks.map(check => {
    const status = typeof check.status === "string" ? check.status : String(check.status ?? "");
    const result = DOCTOR_RESULT[status] || "unknown";
    return {
      id: String(check.id ?? ""),
      title: text(check.title) || String(check.id ?? ""),
      status,
      result,
      resultLabel: RESULTS[result].label || status || "unknown",
      role: RESULTS[result].role,
      detail: text(check.detail),
      fix: text(check.fix),
    };
  });
  const counts = countsOf(rows);
  const parts = [`${counts.fail} of ${plural(counts.total, "check", "checks")} ${counts.fail === 1 ? "fails" : "fail"}`];
  if (counts.warn) parts.push(plural(counts.warn, "warning", "warnings"));
  if (counts.info) parts.push(plural(counts.info, "note", "notes"));
  return {
    view: "health-doctor",
    state: rows.length ? "ready" : "empty",
    freshness: freshnessOf(freshness),
    // branchling's verdict, as CI reads it: false when any check is an error.
    verdict: envelope.ok ? "pass" : "fail",
    ok: envelope.ok,
    root: text(envelope.root),
    // `root: null`: branchling found no backlog where it looked.
    backlogFound: text(envelope.root) !== null,
    next: text(envelope.next),
    counts,
    failing: counts.fail,
    summary: parts.join(" · "),
    checks: byResult(rows),
  };
}

/**
 * @param {object} envelope a `check` envelope from adapter.check()
 * @param {{ stale?: boolean, fetchedAt?: string|null }} [freshness]
 */
export function checkModel(envelope, freshness = {}) {
  if (!envelope || envelope.kind !== "check" || !Array.isArray(envelope.guards) || typeof envelope.ok !== "boolean") {
    throw new TypeError("checkModel needs a check envelope");
  }
  const rows = envelope.guards.map(guard => {
    const result = guard.skipped === true ? "not-run" : guard.ok === true ? "pass" : "fail";
    return {
      name: String(guard.name ?? ""),
      severity: text(guard.severity),
      result,
      resultLabel: RESULTS[result].label,
      role: RESULTS[result].role,
      exit: Number.isInteger(guard.exit) ? guard.exit : null,
      // Several lines, verbatim; the first is the guard's own one-line verdict.
      output: typeof guard.output === "string" ? guard.output.replace(/\s+$/, "") : "",
    };
  });
  const counts = countsOf(rows);
  const ran = counts.total - counts.notRun;
  const parts = [`${counts.fail} of ${plural(ran, "guard", "guards")} ${counts.fail === 1 ? "fails" : "fail"}`];
  if (counts.notRun) parts.push(`${counts.notRun} not run`);
  return {
    view: "health-check",
    state: rows.length ? "ready" : "empty",
    freshness: freshnessOf(freshness),
    verdict: envelope.ok ? "pass" : "fail",
    ok: envelope.ok,
    root: text(envelope.root),
    // `root: null` (since branchling TL-541): no backlog where it looked,
    // answered as a failing verdict with one `backlog` guard, as doctor does.
    backlogFound: text(envelope.root) !== null,
    // The names branchling lists as failed: the field CI acts on.
    failed: Array.isArray(envelope.failed) ? envelope.failed.map(String) : [],
    counts,
    failing: counts.fail,
    summary: parts.join(" · "),
    guards: byResult(rows),
  };
}

/**
 * The tasks another branch or worktree disagrees with, from `stats --json`.
 * Each observation reads `source: status`, the wording branchling itself
 * uses for one (its `describeElsewhere`).
 *
 * @param {object} envelope a `stats` envelope from adapter.stats()
 * @param {{ stale?: boolean, fetchedAt?: string|null }} [freshness]
 */
export function divergentModel(envelope, freshness = {}) {
  if (!envelope || envelope.kind !== "stats" || !Array.isArray(envelope.divergent)) {
    throw new TypeError("divergentModel needs a stats envelope");
  }
  const scan = envelope.scan && typeof envelope.scan === "object" ? envelope.scan : null;
  const tasks = envelope.divergent.map(task => ({
    id: String(task.id ?? ""),
    status: typeof task.status === "string" ? task.status : null,
    elsewhere: (Array.isArray(task.elsewhere) ? task.elsewhere : []).map(o => ({
      source: String(o.source ?? ""),
      kind: text(o.kind),
      status: typeof o.status === "string" ? o.status : null,
      text: `${o.source ?? ""}: ${o.status || "—"}`,
    })),
  }));
  return {
    view: "health-divergent",
    state: tasks.length ? "ready" : "empty",
    freshness: freshnessOf(freshness),
    // `scan.scanned: false` says the branches were not looked at; that is not "none disagrees".
    scanned: scan ? scan.scanned !== false : null,
    scanReason: scan ? text(scan.reason) : null,
    branches: scan && Array.isArray(scan.branches) ? scan.branches.length : null,
    trees: scan && Number.isInteger(scan.trees) ? scan.trees : null,
    count: tasks.length,
    tasks,
  };
}

/**
 * What the page head and the nav badge say, from whichever of the two models
 * has answered (null for one not known yet or failed). The badge is the
 * number of rows marked "fails" on the page: doctor's errors plus the
 * failing guards. doctor's `guards` check repeats some of check's guards, and
 * both are counted, because both rows are on screen saying "fails".
 *
 * @param {{ doctor?: object|null, check?: object|null }} models
 */
export function healthSummary({ doctor = null, check = null } = {}) {
  const known = [doctor, check].filter(m => m && (m.state === "ready" || m.state === "empty"));
  const complete = known.length === 2;
  const failing = known.reduce((n, m) => n + m.failing, 0);
  let headline = null;
  if (complete) {
    if (doctor.verdict === "pass" && check.verdict === "pass") headline = "The setup checks and the release gate pass.";
    else if (doctor.verdict === "fail" && check.verdict === "fail") headline = "The setup checks and the release gate fail.";
    else if (doctor.verdict === "fail") headline = "The setup checks fail; the release gate passes.";
    else headline = "The release gate fails; the setup checks pass.";
  }
  return {
    complete,
    failing,
    // No number until something answered: an absent badge is "not looked", 0 is never shown as a badge.
    badge: known.length && failing > 0 ? { count: failing, role: "danger", label: `${failing} ${HEALTH_TEXT.badgeLabel}` } : null,
    headline,
  };
}
