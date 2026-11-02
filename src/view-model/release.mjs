/**
 * The release view model: plain data computed from a `release-status`
 * envelope (`branchling deploy status --json`, optionally `--release <name>`).
 *
 * Both surfaces render THIS, never the envelope (see src/view-model/stats.mjs
 * for the rules: pure, no `node:` import, no DOM, no markup, no ANSI, no
 * colour values, only sibling imports).
 *
 * What the model decides, so no surface has to:
 *   - one LANE per deploy target and one COLUMN per bucket branchling
 *     computed (closed but not on the trunk, on the trunk waiting for the
 *     first stage, then stage by stage, then the last stage). The buckets are
 *     taken as branchling ordered and placed them; nothing is re-derived here.
 *   - UNKNOWN IS NOT ZERO. A bucket behind a ref that does not resolve has
 *     `count: null` and `countLabel: "unknown"`, whatever number the envelope
 *     carries beside it: "0 in production" would read as "nothing deployed".
 *   - the last stage is COUNTED, NOT LISTED (`listed: false`), as the CLI does:
 *     it grows with the project's whole history.
 *   - the trunk and every ref read, with its SHA, because the answer is only as
 *     fresh as they are.
 *   - with `--release`, the comparison of the plan with what shipped, in the
 *     sections the CLI prints.
 *   - a backlog with no `deploy_targets` is the EMPTY state with an
 *     explanation, never an error.
 *
 * The wording follows `branchling deploy status`'s own text output, so the
 * web page, the terminal interface and the CLI say the same thing.
 */

import { priorityRole, statusRole } from "./roles.mjs";

/** The headings and sentences of the release view, decided once for every surface. */
export const RELEASE_TEXT = {
  title: "Release pipeline",
  loading: "Loading the release pipeline…",
  stale: "Showing the last known release pipeline; a fresh read is on its way.",
  refs: "Computed from these refs",
  trunk: "trunk",
  release: "Release",
};

const TRUNK_SOURCE_TEXT = {
  "remote-default": "the remote's default branch",
  head: "HEAD, because this clone has no origin/HEAD",
};

const NOTE_TEXT = {
  unscanned: "deployment not read",
  "no-commits": "no commit on the trunk names it",
  "no-target": "its commits touch no deploy target's paths",
  "release-ref-unknown": "unknown: the release's ref does not resolve",
};

function shortSha(sha) {
  return typeof sha === "string" && sha ? sha.slice(0, 12) : null;
}

function str(value) {
  return typeof value === "string" ? value : null;
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function waitedLabel(days) {
  return days === null ? "waiting time unknown" : `waiting ${days}d`;
}

function pipelineTask(task, bucketUnknown) {
  const waitedDays = num(task.waitedDays);
  const state = str(task.state);
  const statusLabel = task.status == null ? "no task file" : String(task.status).replace(/_/g, " ");
  const unknown = bucketUnknown || state === "unknown";
  return {
    id: String(task.id),
    title: str(task.title) ?? "",
    hasFile: task.status !== null && task.status !== undefined,
    status: str(task.status),
    statusLabel,
    role: statusRole(task.status),
    closed: str(task.closed),
    since: str(task.since),
    waitedDays,
    waitedLabel: waitedLabel(waitedDays),
    state,
    unknown,
    // What a row says after its id and title, as the web page lists it.
    notes: [statusLabel + (str(task.closed) ? ` ${str(task.closed)}` : ""), waitedLabel(waitedDays), ...(unknown ? ["unknown"] : [])],
    holding: Array.isArray(task.holding) ? task.holding.map(String) : [],
    refs: (Array.isArray(task.refs) ? task.refs : []).map(r => ({
      spec: String(r.spec),
      sha: str(r.sha),
      shortSha: shortSha(r.sha),
      state: str(r.state),
      held: num(r.held),
      of: num(r.of),
    })),
  };
}

function column(bucket, index) {
  const unknown = bucket.unknown === true;
  const unknownRefs = Array.isArray(bucket.unknownRefs) ? bucket.unknownRefs.map(String) : [];
  const rawCount = num(bucket.count) ?? 0;
  const tasks = (Array.isArray(bucket.tasks) ? bucket.tasks : []).map(t => pipelineTask(t, unknown));
  const listed = bucket.listed !== false;
  const waits = tasks.map(t => t.waitedDays).filter(d => d !== null);
  let unknownDetail = null;
  if (unknown) {
    unknownDetail = `${unknownRefs.join(", ") || "a ref"} does not resolve`
      + (rawCount ? `; ${rawCount} could not be placed past it` : "");
  }
  return {
    key: `${bucket.kind}:${bucket.stage ?? ""}:${index}`,
    kind: String(bucket.kind),
    stage: str(bucket.stage),
    after: str(bucket.after),
    label: str(bucket.label) ?? String(bucket.kind),
    // Never a zero standing in for "could not be judged".
    count: unknown ? null : rawCount,
    countLabel: unknown ? "unknown" : String(rawCount),
    unknown,
    unknownRefs,
    unknownDetail,
    listed,
    listedNote: !listed && !unknown && rawCount ? "counted, not listed" : null,
    tasks,
    longestWaitDays: unknown || !waits.length ? null : Math.max(...waits),
    longestWaitLabel: unknown || !waits.length ? null : `longest wait ${Math.max(...waits)}d`,
  };
}

function lane(target) {
  const repository = str(target.repository);
  return {
    target: String(target.target),
    repository,
    note: repository ? `deployed from the repository ${repository}; its commits and refs are not read here` : null,
    columns: (Array.isArray(target.buckets) ? target.buckets : []).map(column),
  };
}

function refRow(r, records) {
  const resolved = r.status === "resolved" && typeof r.sha === "string";
  const record = records.find(x => x.target === r.target && x.stage === r.stage && x.spec === r.spec);
  return {
    target: String(r.target),
    stage: String(r.stage),
    name: `${r.target}/${r.stage}`,
    spec: String(r.spec),
    ref: str(r.ref),
    resolved,
    sha: resolved ? r.sha : null,
    shortSha: resolved ? shortSha(r.sha) : null,
    shaLabel: resolved ? shortSha(r.sha) : `unknown: ${str(r.why) || "the ref does not resolve"}`,
    recorded: record ? `recorded by ${record.actor} at ${record.at}: ${record.reason}` : null,
  };
}

function standingText(task) {
  if (task.note && NOTE_TEXT[task.note]) return [NOTE_TEXT[task.note]];
  if (task.note) return [String(task.note).replace(/-/g, " ")];
  return (Array.isArray(task.standing) ? task.standing : []).map(s => {
    if (s.ref !== undefined) {
      if (s.state === "full") return `in ${s.ref}`;
      if (s.state === "absent") return `not in ${s.ref}`;
      return `partly in ${s.ref}` + (s.of ? ` (${s.held} of ${s.of} trunk commit(s))` : "");
    }
    if (s.state === "unobservable") return `${s.target}: unobservable, deployed from ${s.repository}`;
    if (s.state === "unknown") return `${s.target}: unknown, a ref of ${s.waitingFor} does not resolve`;
    const where = s.at === null || s.at === undefined ? "on the trunk" : `in ${s.at}`;
    return `${s.target}: ${where}, waiting for ${s.waitingFor}` + (s.state === "partial" ? " (partial)" : "");
  });
}

function releaseTask(task, { where, showPlanned }) {
  const details = [];
  if (showPlanned && task.release) details.push(`planned for ${task.release}`);
  if (where) details.push(...standingText(task));
  const statusLabel = task.status == null ? "no task file" : String(task.status).replace(/_/g, " ");
  return {
    id: String(task.id),
    title: str(task.title) ?? "",
    status: str(task.status),
    statusLabel: task.status == null ? "no task file" : String(task.status).replace(/_/g, " "),
    role: statusRole(task.status),
    priority: str(task.priority),
    priorityRole: priorityRole(task.priority),
    release: str(task.release),
    commits: num(task.commits),
    details,
    notes: [statusLabel, str(task.priority), ...details].filter(Boolean),
  };
}

function section(key, label, part, { where, showPlanned = false }) {
  const unknown = !part || part.count === null || part.unknown === true;
  return {
    key,
    label,
    count: unknown ? null : num(part.count) ?? 0,
    countLabel: unknown ? "unknown" : String(num(part.count) ?? 0),
    unknown,
    tasks: (part && Array.isArray(part.tasks) ? part.tasks : []).map(t => releaseTask(t, { where, showPlanned })),
  };
}

function currentText(scope) {
  if (scope.currentJudged === false) return "which release is current was not judged; deployment was not read";
  if (scope.current === null) return "no current release: every release in releases: has shipped";
  if (scope.current === scope.name) return "the current release, the first in releases: not fully shipped";
  if (typeof scope.current === "string") return `not the current release, which is ${scope.current}`;
  return null;
}

function shippedAtText(at) {
  if (!at) return null;
  if (at.status !== "resolved") return `shipped at ${at.ref}: unknown, ${at.why || "the ref does not resolve"}`;
  let since = "since the root, the first release that names a ref";
  if (at.since) {
    since = `since ${at.since.release} at ${at.since.ref} ` + (at.since.sha ? shortSha(at.since.sha) : `(unknown: ${at.since.why || "the ref does not resolve"})`);
  }
  return `shipped at ${at.ref} ${shortSha(at.sha)}, ${since}`;
}

function releaseComparison(scope) {
  if (!scope || typeof scope !== "object") return null;
  const sections = [section("notShipped", "planned, not shipped", scope.notShipped, { where: true })];
  if (scope.unobservable && num(scope.unobservable.count)) {
    sections.push(section("unobservable", "planned, unobservable here", scope.unobservable, { where: true }));
  }
  sections.push(section("open", "planned, still open", scope.open, { where: false }));
  sections.push(scope.shippedAt
    ? section("shippedUnplanned", "shipped, unplanned", scope.shippedUnplanned, { where: true, showPlanned: true })
    : section("unplanned", "unplanned, carried by the next promotion", scope.unplanned, { where: true, showPlanned: true }));
  sections.push(section("dropped", "planned, then dropped", scope.dropped, { where: false }));
  const shipped = num(scope.shipped?.count);
  return {
    name: String(scope.name),
    planned: num(scope.planned) ?? 0,
    shipped: shipped ?? 0,
    shippedNote: "counted, not listed",
    countsText: `${num(scope.planned) ?? 0} planned · ${shipped ?? 0} shipped (counted, not listed) · ${num(scope.dropped?.count) ?? 0} dropped`,
    dropped: num(scope.dropped?.count) ?? 0,
    isCurrent: scope.current === scope.name,
    current: str(scope.current),
    currentText: currentText(scope),
    shippedAt: scope.shippedAt ? {
      ref: String(scope.shippedAt.ref),
      resolved: scope.shippedAt.status === "resolved",
      sha: str(scope.shippedAt.sha),
      shortSha: shortSha(scope.shippedAt.sha),
    } : null,
    shippedAtText: shippedAtText(scope.shippedAt),
    sections,
  };
}

/**
 * @param {object} envelope a `release-status` envelope from adapter.deployStatus()
 * @param {{ stale?: boolean, fetchedAt?: string|null }} [freshness]
 */
export function releaseModel(envelope, freshness = {}) {
  if (!envelope || envelope.kind !== "release-status" || !Array.isArray(envelope.targets)) {
    throw new TypeError("releaseModel needs a release-status envelope");
  }
  const scan = envelope.scan || {};
  const records = Array.isArray(envelope.records) ? envelope.records : [];
  const trunk = envelope.trunk || {};
  const lanes = envelope.targets.map(lane);
  const filter = envelope.filter || {};
  const unplacedCount = num(envelope.unplaced?.count) ?? 0;
  const empty = lanes.length === 0;

  return {
    view: "release",
    // No deploy targets is an answer about the project, not a fault.
    state: empty ? "empty" : "ready",
    freshness: { stale: freshness.stale === true, fetchedAt: freshness.fetchedAt ?? null },
    filter: { target: str(filter.target), stage: str(filter.stage) },
    emptyState: empty ? {
      reason: str(scan.reason),
      title: "No deploy targets",
      detail: (str(envelope.explanation) || "this project declares no deploy targets")
        + ". The release view needs deploy_targets in the backlog's configuration to show what waits for each stage.",
    } : null,
    trunk: {
      spec: str(trunk.spec) ?? "HEAD",
      sha: str(trunk.sha),
      shortSha: shortSha(trunk.sha),
      shaLabel: shortSha(trunk.sha) || "unresolved",
      source: str(trunk.source),
      sourceText: TRUNK_SOURCE_TEXT[trunk.source] || (trunk.source ? String(trunk.source) : null),
    },
    refs: (Array.isArray(scan.refs) ? scan.refs : [])
      .filter(r => !filter.target || r.target === filter.target)
      .map(r => refRow(r, records)),
    lanes,
    unplaced: {
      count: unplacedCount,
      ids: Array.isArray(envelope.unplaced?.ids) ? envelope.unplaced.ids.map(String) : [],
      text: unplacedCount ? `${unplacedCount} closed task(s) are named by no commit on any ref, so no target can be given to them` : null,
    },
    release: releaseComparison(envelope.release),
  };
}

/** Where a task stands in the model: the lane and column holding it, if listed. */
export function findTask(model, id) {
  for (const l of model.lanes) {
    for (const c of l.columns) {
      if (c.tasks.some(t => t.id === id)) return { target: l.target, kind: c.kind, stage: c.stage, after: c.after, label: c.label };
    }
  }
  return null;
}
