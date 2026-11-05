/**
 * The overview view model (UI-29): plain data computed from the reads the
 * overview makes, one per existing API route (OVERVIEW_READS): `stats`,
 * `plan`, `doctor`, `decisions` and `tasks`. Each read becomes a part with
 * overviewPart(): `{ ok: true, envelope }`, or `{ ok: false, status, error }`
 * with the server's own JSON error for that route, or `{ ok: false,
 * unreachable: true, message }`. A read not answered yet is simply absent.
 *
 * Pure and portable like stats.mjs: no `node:` import, no DOM, no HTML, no
 * ANSI, no I/O, only sibling imports. Both surfaces render THIS. Each part is
 * built by the view model of the view that has the detail (statsModel,
 * planModel, doctorModel, decisionsModel), so a number reads the same here
 * as on that view.
 *
 * TWO QUESTIONS, SIX PARTS. "What needs a person" is `needs`: the open
 * questions, the failing setup checks and the tasks waiting on other tasks.
 * "Where the backlog stands" is `wave` (the active wave and what may start
 * now), `inFlight` and `totals` (with the by-status and by-priority
 * distributions the stats view had). Every part has its own `state`
 * (`loading`, `ready`, `empty`, `error`, `refusal`): a part is loading until
 * the reads it is built from have answered, and one failing read makes the
 * parts built from it an error and leaves the others as they are. A failure
 * is mapped by states.mjs, as on every view, never shown as empty.
 *
 * WHERE EVERY NUMBER COMES FROM. From an envelope, never from status names.
 * The `vocabulary` envelope (UI-18) gives colour and order only; a count is
 * taken as branchling computed it even though the archived set is now known,
 * because branchling's number is the answer and a recount could only differ:
 *
 *   open questions     decisionsModel's count (log --open-questions)
 *   failing checks     doctorModel's `failing` (doctor rows with status error)
 *   waiting on others  stats `blocked`: ACTIVE tasks whose `blocked_by` is not
 *                      empty, as `branchling stats` counts them (its own
 *                      report calls it "waiting on other tasks"). It is NOT
 *                      the status named `blocked`: a task stopped by `ask`
 *                      has that status and no `blocked_by`, and a task with a
 *                      `blocked_by` keeps its own status. The listed ids are
 *                      the task list's rows with a non-empty `blocked_by`,
 *                      the same rule over the same active scope.
 *   active wave        planModel's summary (plan `activeWave`, `nextUp`)
 *   in flight          the task list's rows whose status is the plan's
 *                      `inProgressStatus`, the name branchling itself says
 *                      means "in flight"; without it, plan `inProgress`
 *   totals             statsModel (stats `total`, `active`, `archived`,
 *                      `blocked`, `openHours`, `byStatus`, `byPriority`)
 */

import { decisionsFailure, decisionsModel } from "./decisions.mjs";
import { doctorModel } from "./health.mjs";
import { isPlanRefusal, planModel, planRefusalState } from "./plan.mjs";
import { statusRole } from "./roles.mjs";
import { fromApiError, unreachableState } from "./states.mjs";
import { statsModel } from "./stats.mjs";
import { tasksHref } from "./tasks.mjs";

/** The sentences and headings of the overview, decided once for both surfaces. */
export const OVERVIEW_TEXT = {
  title: "Overview",
  lede: "What needs a person, and where the backlog stands.",
  loading: "Loading the overview…",
  partLoading: "Loading…",
  stale: "Showing the last known overview; a fresh read is on its way.",
  needsTitle: "Needs a person",
  standsTitle: "Where the backlog stands",
  questionsHeading: "Open questions",
  questionsTitle: "Questions waiting on a person",
  questionsNone: "No question waits on a person.",
  questionsLink: "Answer them",
  questionsLinkNone: "Open the decisions",
  checksHeading: "Setup checks",
  checksTitle: "The setup checks fail",
  checksNone: "No setup check fails.",
  checksLink: "See the checks",
  blockedHeading: "Waiting on other tasks",
  blockedTitle: "Tasks waiting on other tasks",
  blockedNone: "No open task waits on another task.",
  blockedNote: "Open tasks with a blocked_by, as branchling stats counts them; not the status named blocked.",
  blockedLink: "See the tasks",
  waveHeading: "Active wave",
  waveNoPlan: "This backlog has no execution plan.",
  waveNoWaves: "The plan schedules no waves yet.",
  waveFinished: "Every wave is closed; the plan is finished.",
  waveNoneStartable: "Nothing in the active wave may start now.",
  waveLink: "Open the plan",
  inFlightHeading: "In flight",
  inFlightNote: "who holds what now",
  inFlightNone: "Nothing is in flight.",
  inFlightLink: "All tasks in flight",
  totalsHeading: "Totals",
  totalsSource: "from branchling stats",
  totalsEmpty: "This backlog has no tasks yet.",
  byStatus: "By status",
  byPriority: "Open by priority",
  allTasks: "All tasks",
  more: "more",
};

/** How many rows a "needs" card lists before saying how many more there are. */
export const OVERVIEW_LIST_LIMIT = 3;

const PART_VIEWS = {
  questions: "overview-questions",
  checks: "overview-checks",
  blocked: "overview-blocked",
  wave: "overview-wave",
  inFlight: "overview-in-flight",
  totals: "overview-totals",
};

const HEADINGS = {
  questions: OVERVIEW_TEXT.questionsHeading,
  checks: OVERVIEW_TEXT.checksHeading,
  blocked: OVERVIEW_TEXT.blockedHeading,
  wave: OVERVIEW_TEXT.waveHeading,
  inFlight: OVERVIEW_TEXT.inFlightHeading,
  totals: OVERVIEW_TEXT.totalsHeading,
};

/** Each part, and the reads it is built from (the first failing one names its error). */
const SOURCES = {
  questions: ["decisions"],
  checks: ["doctor"],
  blocked: ["stats"],
  wave: ["plan"],
  inFlight: ["tasks", "plan"],
  totals: ["stats"],
};

/** Where each part's detail is. */
const LINKS = {
  questions: "?view=decisions",
  checks: "?view=health",
  blocked: tasksHref({}),
  wave: "?view=plan",
  inFlight: tasksHref({}),
  totals: tasksHref({}),
};

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function freshnessOf(freshness = {}) {
  return { stale: freshness.stale === true, fetchedAt: freshness.fetchedAt ?? null };
}

const str = value => (typeof value === "string" && value.trim() ? value : null);

function base(key, state) {
  return { key, view: PART_VIEWS[key], heading: HEADINGS[key], state };
}

/**
 * How a failed read is said. A refused plan carries the plan envelope
 * (TL-534) and is said as the plan view says it (UI-22, UI-47): its own
 * heading per refusalKind and every problem branchling listed, never the
 * generic "branchling declined the request".
 */
function failureOf(key, source, part) {
  const body = { error: part.error || {} };
  if (source === "decisions") return decisionsFailure(body, part.status);
  if (source === "plan" && body.error.type === "refusal" && isPlanRefusal(body.error.envelope)) {
    return { ...planRefusalState(body.error.envelope), httpStatus: part.status ?? null };
  }
  return fromApiError(PART_VIEWS[key], body, part.status);
}

/** A part whose read failed: the state, title and detail states.mjs gives that failure. */
function failedPart(key, source, part, mapped = null) {
  const failure = mapped || failureOf(key, source, part);
  return {
    ...base(key, failure.state === "refusal" ? "refusal" : "error"),
    source,
    failure: {
      title: failure.title,
      detail: failure.detail,
      details: Array.isArray(failure.details) ? failure.details.map(String) : [],
      hint: typeof failure.hint === "string" && failure.hint ? failure.hint : null,
      refusalKind: failure.refusalKind ?? null,
      errorType: failure.errorType ?? (failure.state === "refusal" ? "refusal" : null),
      httpStatus: failure.httpStatus ?? part.status ?? null,
    },
    link: { href: LINKS[key], label: null },
  };
}

/** An envelope that is there but not of the shape a builder needs: a contract fault, not an empty part. */
function shapePart(key, source, err) {
  return failedPart(key, source, { status: 502, error: { type: "contract-mismatch", message: String(err && err.message || err) } });
}

const envelopeOf = part => (part && part.ok === true ? part.envelope : null);

/* ---------- what needs a person ---------- */

function questionsPart(parts, freshness, now) {
  const model = decisionsModel(envelopeOf(parts.decisions), freshness, now);
  const count = model.count;
  const shown = model.questions.slice(0, OVERVIEW_LIST_LIMIT);
  return {
    ...base("questions", count ? "ready" : "empty"),
    count,
    badge: count
      ? { label: plural(count, "open question", "open questions"), role: "attention" }
      : { label: "0 open questions", role: "neutral" },
    title: count ? OVERVIEW_TEXT.questionsTitle : OVERVIEW_TEXT.questionsNone,
    meta: count ? `on ${plural(model.taskCount, "task", "tasks")} · oldest ${model.questions[0].ageLabel}` : null,
    lines: shown.map(q => ({ id: q.taskId, label: null, text: q.text || q.title, href: null })),
    more: count > shown.length ? `${count - shown.length} ${OVERVIEW_TEXT.more}` : null,
    note: null,
    link: { href: LINKS.questions, label: count ? OVERVIEW_TEXT.questionsLink : OVERVIEW_TEXT.questionsLinkNone },
  };
}

function checksPart(parts, freshness) {
  const model = doctorModel(envelopeOf(parts.doctor), freshness);
  const failing = model.checks.filter(c => c.result === "fail");
  const count = model.failing;
  const shown = failing.slice(0, OVERVIEW_LIST_LIMIT);
  return {
    ...base("checks", count ? "ready" : "empty"),
    count,
    badge: count
      ? { label: plural(count, "failing check", "failing checks"), role: "danger" }
      : { label: "0 failing checks", role: "success" },
    title: count ? OVERVIEW_TEXT.checksTitle : OVERVIEW_TEXT.checksNone,
    meta: model.summary,
    lines: shown.map(c => ({ id: null, label: c.title, text: c.detail || c.title, href: null })),
    more: count > shown.length ? `${count - shown.length} ${OVERVIEW_TEXT.more}` : null,
    note: null,
    link: { href: LINKS.checks, label: OVERVIEW_TEXT.checksLink },
  };
}

function blockedPart(parts, freshness) {
  const stats = statsModel(envelopeOf(parts.stats), freshness);
  const count = stats.totals.find(t => t.key === "blocked").value;
  const list = envelopeOf(parts.tasks);
  const rows = list && Array.isArray(list.tasks)
    ? list.tasks.filter(t => t && Array.isArray(t.blocked_by) && t.blocked_by.length > 0)
    : [];
  const shown = rows.slice(0, OVERVIEW_LIST_LIMIT);
  return {
    ...base("blocked", count ? "ready" : "empty"),
    count,
    badge: count
      ? { label: `${count} waiting`, role: "attention" }
      : { label: "0 waiting", role: "neutral" },
    title: count ? OVERVIEW_TEXT.blockedTitle : OVERVIEW_TEXT.blockedNone,
    meta: null,
    lines: shown.map(t => ({
      id: String(t.id),
      label: null,
      text: `${str(t.title) ?? String(t.id)} · waits on ${t.blocked_by.map(String).join(", ")}`,
      href: tasksHref({}, String(t.id)),
    })),
    more: count > shown.length && shown.length ? `${count - shown.length} ${OVERVIEW_TEXT.more}` : null,
    note: OVERVIEW_TEXT.blockedNote,
    link: { href: LINKS.blocked, label: OVERVIEW_TEXT.blockedLink },
  };
}

/* ---------- where the backlog stands ---------- */

function wavePart(parts, freshness) {
  const list = envelopeOf(parts.tasks);
  const plan = planModel(envelopeOf(parts.plan), freshness, list && list.kind === "task-list" && Array.isArray(list.tasks) ? list : null);
  const link = { href: LINKS.wave, label: OVERVIEW_TEXT.waveLink };
  // A refusal envelope that reached here as an answer: the same refusal as a 409.
  if (plan.state === "refusal") {
    return failedPart("wave", "plan", { status: null, error: { type: "refusal" } }, plan);
  }
  if (plan.state === "empty") {
    return {
      ...base("wave", "empty"),
      badge: null,
      title: plan.emptyReason === "no-plan" ? OVERVIEW_TEXT.waveNoPlan : OVERVIEW_TEXT.waveNoWaves,
      meta: null, lines: [], more: null, note: null, link,
      activeWave: null, inFlight: 0,
    };
  }
  const s = plan.summary;
  if (!s.activeWave) {
    return {
      ...base("wave", "ready"),
      badge: { label: `${s.waveCount} of ${s.waveCount} waves closed`, role: "success" },
      title: OVERVIEW_TEXT.waveFinished,
      meta: `${s.plannedClosed} of ${s.plannedTotal} planned tasks closed`,
      lines: [], more: null, note: null, link,
      activeWave: null, inFlight: s.inFlight,
    };
  }
  const active = plan.waves.find(w => w.active);
  const startable = plan.mayStartNow.flatMap(item => item.tasks);
  return {
    ...base("wave", "ready"),
    badge: { label: `Wave ${s.activeWave.number} of ${s.waveCount}`, role: "progress" },
    title: startable.length
      ? `${plural(startable.length, "task", "tasks")} may start now`
      : OVERVIEW_TEXT.waveNoneStartable,
    meta: `${s.activeWave.name} · ${active.progressLabel} · ${s.inFlight} in flight`,
    lines: startable.slice(0, OVERVIEW_LIST_LIMIT).map(t => ({ id: t.id, label: null, text: t.title || t.id, href: null })),
    more: startable.length > OVERVIEW_LIST_LIMIT ? `${startable.length - OVERVIEW_LIST_LIMIT} ${OVERVIEW_TEXT.more}` : null,
    note: null,
    link,
    activeWave: { ...s.activeWave },
    inFlight: s.inFlight,
  };
}

function inFlightPart(parts) {
  const list = envelopeOf(parts.tasks);
  const plan = envelopeOf(parts.plan);
  if (!plan || plan.kind !== "plan") throw new TypeError("the in-flight part needs a plan envelope");
  if (!list || list.kind !== "task-list" || !Array.isArray(list.tasks)) throw new TypeError("the in-flight part needs a task-list envelope");
  const byId = new Map(list.tasks.map(t => [t.id, t]));
  const statusName = str(plan.inProgressStatus);
  const picked = statusName
    ? list.tasks.filter(t => t && t.status === statusName)
    : (Array.isArray(plan.inProgress) ? plan.inProgress : []).map(p => byId.get(p.id) || { id: p.id, status: p.status });
  const rows = picked.map(t => {
    const status = str(t.status);
    const owner = str(t.owner);
    return {
      id: String(t.id),
      title: str(t.title),
      status,
      statusLabel: status ? status.replace(/_/g, " ") : null,
      role: statusRole(status),
      owner: owner && owner !== "unassigned" ? owner : null,
      priority: str(t.priority),
      href: tasksHref({}, String(t.id)),
    };
  });
  return {
    ...base("inFlight", rows.length ? "ready" : "empty"),
    count: rows.length,
    title: rows.length ? null : OVERVIEW_TEXT.inFlightNone,
    note: OVERVIEW_TEXT.inFlightNote,
    rows,
    link: { href: statusName ? tasksHref({ status: statusName }) : LINKS.inFlight, label: OVERVIEW_TEXT.inFlightLink },
  };
}

function share(count, of) {
  return of > 0 ? Math.round((count / of) * 100) : 0;
}

function totalsPart(parts, freshness) {
  const stats = statsModel(envelopeOf(parts.stats), freshness);
  const value = key => stats.totals.find(t => t.key === key).value;
  const total = value("total");
  const active = value("active");
  const hours = stats.openHours;
  return {
    ...base("totals", stats.state),
    title: stats.state === "empty" ? OVERVIEW_TEXT.totalsEmpty : null,
    source: OVERVIEW_TEXT.totalsSource,
    tiles: [
      { key: "active", label: "Open", value: String(active), unit: null, note: `of ${plural(total, "task", "tasks")}` },
      { key: "blocked", label: "Waiting on other tasks", value: String(value("blocked")), unit: null, note: "with a blocked_by" },
      { key: "archived", label: "Archived", value: String(value("archived")), unit: null, note: null },
      {
        key: "openHours",
        label: "Open hours",
        value: String(hours.hours),
        unit: "h",
        note: hours.unknown ? `${plural(hours.unknown, "task", "tasks")} without a countable estimate` : null,
      },
    ],
    byStatus: stats.byStatus.map(row => ({ ...row, share: share(row.count, total), href: tasksHref({ status: row.key }) })),
    byPriority: stats.byPriority.map(row => ({ ...row, share: share(row.count, active), href: tasksHref({ priority: row.key }) })),
    link: { href: LINKS.totals, label: OVERVIEW_TEXT.allTasks },
  };
}

const BUILDERS = {
  questions: questionsPart,
  checks: checksPart,
  blocked: blockedPart,
  wave: wavePart,
  inFlight: inFlightPart,
  totals: totalsPart,
};

/**
 * The reads the overview makes: each is an existing route, so its errors are
 * the server's own mapping and its cost is the cache's (docs/architecture.md,
 * "The overview"). The page fetches them in parallel and renders each part as
 * soon as its reads have answered.
 */
export const OVERVIEW_READS = Object.freeze({
  stats: "/api/stats",
  plan: "/api/plan",
  doctor: "/api/health/doctor",
  decisions: "/api/decisions",
  tasks: "/api/plan/tasks",
});

/**
 * One read's response as a part of the overview.
 * @param {{ ok: boolean, status?: number, body?: any, unreachable?: boolean, message?: string }} response
 */
export function overviewPart(response) {
  if (response && response.unreachable) return { ok: false, unreachable: true, message: String(response.message || "") };
  if (response && response.ok) return { ok: true, envelope: response.body };
  const error = response && response.body && typeof response.body.error === "object" && response.body.error
    ? response.body.error
    : { type: "internal", message: "The answer carried no error body." };
  return { ok: false, status: typeof response?.status === "number" ? response.status : null, error };
}

function buildPart(key, parts, freshness, now) {
  const failed = SOURCES[key].find(source => parts[source] && parts[source].ok !== true);
  if (failed) {
    const part = parts[failed];
    if (part.unreachable) {
      const u = unreachableState(PART_VIEWS[key], part.message);
      return failedPart(key, failed, { status: null, error: { type: "unreachable", message: u.detail } }, u);
    }
    return failedPart(key, failed, part);
  }
  if (SOURCES[key].some(source => !parts[source])) {
    return { ...base(key, "loading"), loadingText: OVERVIEW_TEXT.partLoading, link: { href: LINKS[key], label: null } };
  }
  try {
    return BUILDERS[key](parts, freshness, now);
  } catch (err) {
    if (err instanceof TypeError) return shapePart(key, SOURCES[key][0], err);
    throw err;
  }
}

/**
 * @param {Partial<Record<keyof OVERVIEW_READS, object>>} parts what overviewPart()
 *   made of each read that has answered; a read still on its way is absent
 * @param {{ stale?: boolean, fetchedAt?: string|null }} [freshness] the oldest
 *   answer's time; stale while a remembered answer waits for a fresh one
 * @param {number|string} [now] the current time, for the questions' ages
 */
export function overviewModel(parts = {}, freshness = {}, now) {
  if (!parts || typeof parts !== "object") throw new TypeError("overviewModel needs the overview's parts");
  const fresh = freshnessOf(freshness);
  const root = ["stats", "plan", "doctor"].map(k => envelopeOf(parts[k])).map(e => e && str(e.root)).find(Boolean) ?? null;
  const partOf = key => buildPart(key, parts, fresh, now);
  const model = {
    view: "overview",
    state: "ready",
    freshness: fresh,
    root,
    title: OVERVIEW_TEXT.title,
    lede: OVERVIEW_TEXT.lede,
    needs: ["questions", "checks", "blocked"].map(partOf),
    wave: partOf("wave"),
    inFlight: partOf("inFlight"),
    totals: partOf("totals"),
  };
  const all = [...model.needs, model.wave, model.inFlight, model.totals];
  // The whole view is loading only until its first part is known.
  if (all.every(p => p.state === "loading")) model.state = "loading";
  return model;
}

/** Before any read has answered: every part loading. */
export function overviewLoading() {
  return overviewModel({});
}
