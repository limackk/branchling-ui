/**
 * The tasks view model (UI-26): every task `query --json` returns, as rows a
 * surface can list, plus the filters that selected them, read from and
 * written to URL search params so a filtered list survives a reload, a shared
 * link and the Back button.
 *
 * Pure and portable like stats.mjs: no `node:` import, no DOM, no HTML, no
 * ANSI, no I/O. `URLSearchParams` is a global in both the browser and Node,
 * so it needs no import. Both surfaces render THIS.
 *
 * WHICH TASKS. Without a status filter, `query` searches the ACTIVE tasks
 * only: branchling leaves the backlog's archived statuses out. With one, it
 * searches exactly the statuses named, which is how a closed task is reached.
 * branchling 0.2.0 has no flag for "every status" that does not name them, so
 * the model says which set is shown instead of offering one.
 *
 * THE FILTERS map one to one onto `query` flags (`--text`, `--status`,
 * `--priority`, `--board`, `--epic`, `--owner`, `--label`). Narrowing is
 * branchling's, never this module's: a value is passed on as typed, and a
 * comma inside one is branchling's OR. No status, priority or board name is
 * written here; the values offered come from the answers (the rows, and the
 * keys of a `stats` envelope when one is given) until UI-18 brings the
 * vocabulary.
 */

import { priorityRole, statusRole } from "./roles.mjs";
import { fromApiError, loadingState } from "./states.mjs";

/** Before the first answer. */
export function tasksLoading() {
  return loadingState("tasks");
}

/**
 * A failed `/api/tasks` answer: `error`, `refusal` (branchling declined) or
 * `rejected` (a status, priority or board name it does not know). Never an
 * empty list: an empty list after a refusal reads like an empty backlog.
 */
export function tasksFailure(body, status) {
  return fromApiError("tasks", body, status);
}

/** The filters, in the order they are written to the URL and shown. */
export const TASK_FILTER_KEYS = ["text", "status", "priority", "board", "epic", "owner", "label"];

/** Labels for the filters, the same on both surfaces. */
export const TASK_FILTER_LABELS = {
  text: "Id or title",
  status: "Status",
  priority: "Priority",
  board: "Board",
  epic: "Epic",
  owner: "Owner",
  label: "Label",
};

/** The longest filter value accepted; longer is a typo or an attack, not a filter. */
export const FILTER_MAX_LENGTH = 200;

/** A task id's shape: a prefix, a hyphen, a number (the prefix is the backlog's own). */
export const TASK_ID_SHAPE = /^[A-Za-z][A-Za-z0-9_]{0,31}-[0-9]{1,9}$/;

export const TASKS_TEXT = {
  loading: "Loading the tasks…",
  stale: "This list was remembered from an earlier answer; a fresh one is on its way.",
  scopeActive: "Showing active tasks. branchling leaves archived statuses out unless a status filter names them.",
  scopeStatus: status => `Showing tasks with status ${status}.`,
  emptyNoTasks: "This backlog has no tasks yet.",
  emptyNoActive: "There are no active tasks. Archived tasks are listed when a status filter names their status.",
  emptyNoMatch: "No task matches these filters.",
  emptyNoMatchHint: "Change or clear a filter to see more tasks.",
  filtersSummary: n => (n > 0 ? `Filters · ${n} active` : "Filters"),
  selectionPending: "The task panel is not built yet; this page shows the selected task's id only.",
  selectionMissing: id => `${id} is not in this list. It may be archived or outside the filters.`,
  none: "—",
};

const label = key => String(key).replace(/_/g, " ");

function freshnessOf(freshness = {}) {
  return { stale: freshness.stale === true, fetchedAt: freshness.fetchedAt ?? null };
}

function text(value) {
  return typeof value === "string" ? value : "";
}

/**
 * How many of the field filters (every filter but the search text) are set:
 * the count the collapsed "Filters" control shows, so a list narrowed by a
 * filter that is out of sight still says so.
 */
export function activeFieldFilterCount(filters = {}) {
  if (!filters || typeof filters !== "object") return 0;
  return TASK_FILTER_KEYS.filter(k => k !== "text" && typeof filters[k] === "string" && filters[k].trim() !== "").length;
}

/** The text of the "Filters" control for these filters. */
export function filtersSummaryText(filters = {}) {
  return TASKS_TEXT.filtersSummary(activeFieldFilterCount(filters));
}

/**
 * The filters in `params` (a URLSearchParams, or anything with `get`). Only
 * the known keys, trimmed, and only those with a value: an empty field is no
 * filter. Values are not judged here; the server refuses a bad one with a 400.
 *
 * @param {{ get(key: string): string|null }} params
 * @returns {Record<string, string>}
 */
export function parseTaskFilters(params) {
  const filters = {};
  if (!params || typeof params.get !== "function") return filters;
  for (const key of TASK_FILTER_KEYS) {
    const value = params.get(key);
    if (typeof value === "string" && value.trim() !== "") filters[key] = value.trim();
  }
  return filters;
}

/**
 * The filters as URL search params, known keys only, in TASK_FILTER_KEYS
 * order, without `view` (see tasksHref). `parseTaskFilters(new
 * URLSearchParams(writeTaskFilters(f)))` deep-equals `f` for any `f` that
 * parseTaskFilters could have returned.
 *
 * @param {Record<string, string>} filters
 * @returns {string}
 */
export function writeTaskFilters(filters = {}) {
  const params = new URLSearchParams();
  for (const key of TASK_FILTER_KEYS) {
    const value = filters && filters[key];
    if (typeof value === "string" && value.trim() !== "") params.set(key, value.trim());
  }
  return params.toString();
}

/**
 * The page address of a filtered list, and of one task opened over it:
 * `?view=tasks&status=pending&task=TASK-3`. The task panel (the next task in
 * this wave) reads `task`; the filters stay, so closing it returns to the list
 * it came from.
 */
export function tasksHref(filters = {}, task = null) {
  const query = writeTaskFilters(filters);
  let href = "?view=tasks" + (query ? "&" + query : "");
  if (typeof task === "string" && TASK_ID_SHAPE.test(task)) href += "&task=" + encodeURIComponent(task);
  return href;
}

/** The selected task id from `?task=`, or null when absent or not an id. */
export function parseTaskSelection(params) {
  if (!params || typeof params.get !== "function") return null;
  const id = params.get("task");
  return typeof id === "string" && TASK_ID_SHAPE.test(id) ? id : null;
}

/**
 * Checks filters before anything is spawned. A value is a string up to
 * FILTER_MAX_LENGTH, without control characters, and neither it nor any of
 * its comma-separated parts starts with `-`: branchling would read such a
 * value as a flag. Keys outside TASK_FILTER_KEYS are dropped, empty values
 * are no filter.
 *
 * @returns {{ ok: true, value: Record<string,string> } | { ok: false, key: string, message: string }}
 */
export function validateTaskFilters(input) {
  const value = {};
  if (input === null || input === undefined) return { ok: true, value };
  if (typeof input !== "object") return { ok: false, key: "", message: "The filters must be key and value pairs" };
  for (const key of TASK_FILTER_KEYS) {
    const raw = input[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") return { ok: false, key, message: `The ${key} filter must be text` };
    const v = raw.trim();
    if (v === "") continue;
    if (v.length > FILTER_MAX_LENGTH) return { ok: false, key, message: `The ${key} filter is longer than ${FILTER_MAX_LENGTH} characters` };
    if (/[\u0000-\u001f\u007f]/.test(v)) return { ok: false, key, message: `The ${key} filter contains a control character` };
    if (v.startsWith("-") || v.split(",").some(part => part.trim().startsWith("-"))) {
      return { ok: false, key, message: `The ${key} filter cannot start with "-": branchling would read it as a flag` };
    }
    value[key] = v;
  }
  return { ok: true, value };
}

/** Values in first-seen order, without blanks and without duplicates. */
function unique(values) {
  const out = [];
  for (const v of values) {
    const s = typeof v === "string" ? v : "";
    if (s && s !== "—" && !out.includes(s)) out.push(s);
  }
  return out;
}

/** The keys of one `stats` count map, or nothing. */
function statsKeys(stats, key) {
  const map = stats && stats.kind === "stats" && stats.stats && stats.stats[key];
  return map && typeof map === "object" ? Object.keys(map) : [];
}

function row(task, filters, selected) {
  const status = text(task.status);
  const priority = text(task.priority);
  const owner = text(task.owner);
  const epic = text(task.epic);
  const board = text(task.board);
  const labels = Array.isArray(task.labels) ? task.labels.filter(l => typeof l === "string" && l) : [];
  const meta = [epic, ...labels.map(l => `#${l}`)].filter(Boolean);
  return {
    id: task.id,
    title: text(task.title) || task.id,
    status,
    statusLabel: status ? label(status) : TASKS_TEXT.none,
    statusRole: statusRole(status),
    priority,
    priorityLabel: priority || TASKS_TEXT.none,
    priorityRole: priorityRole(priority),
    owner: owner || null,
    ownerLabel: owner || TASKS_TEXT.none,
    board: board || null,
    boardLabel: board || TASKS_TEXT.none,
    epic: epic || null,
    labels,
    meta: meta.join(" · "),
    blockedBy: Array.isArray(task.blocked_by) ? task.blocked_by.map(String) : [],
    href: tasksHref(filters, task.id),
    selected: selected === task.id,
  };
}

/**
 * @param {object} envelope a `task-list` envelope from adapter.query(filters)
 * @param {Record<string,string>} [filters] the filters that produced it
 * @param {{ stale?: boolean, fetchedAt?: string|null }} [freshness]
 * @param {{ stats?: object|null, task?: string|null }} [options] `stats`: a
 *   `stats` envelope whose keys widen the values offered per filter (and say
 *   whether the backlog holds any task at all); `task`: the selected task id
 */
export function tasksModel(envelope, filters = {}, freshness = {}, { stats = null, task = null } = {}) {
  if (!envelope || envelope.kind !== "task-list" || !Array.isArray(envelope.tasks)) {
    throw new TypeError("tasksModel needs a task-list envelope");
  }
  const applied = parseTaskFilters({ get: key => (typeof filters[key] === "string" ? filters[key] : null) });
  const selected = typeof task === "string" && TASK_ID_SHAPE.test(task) ? task : null;
  const tasks = envelope.tasks.filter(t => t && typeof t.id === "string" && t.id);
  const rows = tasks.map(t => row(t, applied, selected));
  const filtered = Object.keys(applied).length > 0;

  const scope = applied.status
    ? { kind: "status", text: TASKS_TEXT.scopeStatus(applied.status) }
    : { kind: "active", text: TASKS_TEXT.scopeActive };

  const total = Number.isInteger(envelope.total) ? envelope.total : rows.length;
  const limit = Number.isInteger(envelope.limit) ? envelope.limit : null;
  const noun = n => (n === 1 ? "task" : "tasks");
  let countText;
  if (limit !== null && total > rows.length) countText = `Showing ${rows.length} of ${total} ${noun(total)}`;
  else if (filtered) countText = `${rows.length} ${noun(rows.length)} ${rows.length === 1 ? "matches" : "match"} these filters`;
  else countText = `${rows.length} ${noun(rows.length)}`;

  const statsTotal = stats && stats.kind === "stats" && stats.stats && Number.isInteger(stats.stats.total) ? stats.stats.total : null;
  let emptyKind = null;
  let emptyText = null;
  let emptyHint = null;
  if (!rows.length) {
    if (filtered) {
      emptyKind = "no-match";
      emptyText = TASKS_TEXT.emptyNoMatch;
      emptyHint = TASKS_TEXT.emptyNoMatchHint;
    } else if (statsTotal === 0) {
      emptyKind = "no-tasks";
      emptyText = TASKS_TEXT.emptyNoTasks;
    } else {
      emptyKind = "no-active";
      emptyText = TASKS_TEXT.emptyNoActive;
    }
  }

  const options = {
    text: [],
    status: unique([...statsKeys(stats, "byStatus"), ...rows.map(r => r.status)]),
    priority: unique([...statsKeys(stats, "byPriority"), ...rows.map(r => r.priority)]),
    board: unique([...statsKeys(stats, "byBoard"), ...rows.map(r => r.board)]),
    epic: unique([...statsKeys(stats, "byEpic"), ...rows.map(r => r.epic)]),
    owner: unique([...statsKeys(stats, "byOwner"), ...rows.map(r => r.owner)]),
    label: unique([...statsKeys(stats, "byLabel"), ...rows.flatMap(r => r.labels)]),
  };

  const active = TASK_FILTER_KEYS.filter(k => applied[k]).map(key => ({ key, label: TASK_FILTER_LABELS[key], value: applied[key] }));
  const caption = [
    applied.status ? `Tasks with status ${applied.status}` : "Active tasks",
    ...active.filter(f => f.key !== "status").map(f => `${f.label.toLowerCase()} ${f.value}`),
  ].join(", ");

  let selection = null;
  if (selected) {
    const inList = rows.some(r => r.id === selected);
    selection = {
      id: selected,
      inList,
      text: inList ? TASKS_TEXT.selectionPending : TASKS_TEXT.selectionMissing(selected),
      closeHref: tasksHref(applied),
    };
  }

  return {
    view: "tasks",
    state: rows.length ? "ready" : "empty",
    freshness: freshnessOf(freshness),
    filters: applied,
    filtered,
    activeFilters: active,
    filtersSummary: filtersSummaryText(applied),
    scope,
    count: { shown: rows.length, total, limit, text: countText },
    caption,
    emptyKind,
    emptyText,
    emptyHint,
    rows,
    options,
    selection,
    clearHref: tasksHref({}),
  };
}
