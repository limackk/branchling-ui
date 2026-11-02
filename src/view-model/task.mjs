/**
 * The task panel's view model (UI-27): everything about one task, from the
 * composed `task-panel` answer (readTask in src/adapter.mjs), for the panel
 * that opens over any view at `?task=<ID>`.
 *
 * Pure and portable like stats.mjs: no `node:` import, no DOM, no HTML, no
 * ANSI, no I/O. `URLSearchParams` is a global in the browser and in Node.
 * Both surfaces render THIS.
 *
 * WHERE EVERY PART COMES FROM (branchling 0.2.0):
 *
 *   status, priority, title     `show --json` (task-show)
 *   blocked, blocked by         `show --json`: `blocked` and `blockers[]`, each
 *                               with its own `resolved` verdict
 *   blocks (the other way)      `query --blocked-by <ID> --json`: ACTIVE tasks
 *                               only, branchling's default scope, so a closed
 *                               task that named this one is not listed
 *   the other fields            the task's row of `query --text <ID> --status
 *                               <its status> --json` (owner, epic, labels,
 *                               estimate, …): `show` does not carry them
 *   history                     `log <ID> --json` (task-log), one exchange per
 *                               write, in branchling's order (oldest first)
 *   body                        NOT AVAILABLE. `show` deliberately never prints
 *                               the body ("read the file"), and no other read
 *                               of the pin does; this package may not read the
 *                               file. So the model says `body.known: false`
 *                               instead of showing nothing as if it were
 *                               empty. `markdownBlocks` is ready for the day a
 *                               read gives it, as `answer.body` (a string).
 */

import { priorityRole, statusRole } from "./roles.mjs";
import { fromApiError, loadingState } from "./states.mjs";
import { TASK_ID_SHAPE } from "./tasks.mjs";

export { TASK_ID_SHAPE };

const label = key => String(key).replace(/_/g, " ");
const str = value => (typeof value === "string" ? value : "");

export const TASK_TEXT = {
  panelLabel: "Task",
  close: "Close task panel",
  loading: id => `Loading ${id}…`,
  stale: "Showing what was last read about this task; a fresh read is on its way.",
  asOf: "As of",
  fields: "Fields",
  fieldsUnknown: "branchling did not list this task's row, so only the fields show gives are shown.",
  blockers: "Blockers",
  blockedBy: "Blocked by",
  blocks: "Blocks",
  noBlockers: "Nothing blocks this task.",
  noBlocks: "No active task waits on this one.",
  blocksScope: "Active tasks only: branchling leaves closed ones out of this list.",
  computed: "What branchling computed",
  blockedYes: "Blocked: a blocker is still open.",
  blockedNo: "Not blocked.",
  elsewhere: n => `Different on ${n} other ${n === 1 ? "branch or worktree" : "branches or worktrees"}.`,
  body: "Body",
  bodyUnavailable: "The description is in the task file named above; this interface cannot read it yet.",
  bodyEmpty: "The body is empty.",
  history: "History",
  historyOrder: "Oldest first, as branchling recorded it.",
  historyEmpty: "Nothing is recorded for this task yet.",
  historySlice: (shown, total) => `Showing ${shown} of ${total} exchanges.`,
  none: "—",
  notFoundTitle: id => `No task ${id}`,
  notFoundDetail: "This backlog has no task with that id. It may have been renumbered, or the link came from another backlog.",
  notAnIdTitle: "Not a task id",
  notAnIdDetail: id => `“${id}” is not a task id: an id is a prefix, a hyphen and a number, like TASK-1.`,
  branchlingSaid: "branchling said",
};

function freshnessOf(freshness = {}) {
  return { stale: freshness.stale === true, fetchedAt: freshness.fetchedAt ?? null };
}

/* ---------- URLs: `?task=` on whatever view is showing ---------- */

/** The selected task id from `?task=` as typed (not judged), or null. */
export function taskParam(search) {
  const id = new URLSearchParams(search || "").get("task");
  return typeof id === "string" && id !== "" ? id : null;
}

/** The current address with `task=<id>` set, every other parameter kept. */
export function taskPanelHref(search, id) {
  const params = new URLSearchParams(search || "");
  params.set("task", id);
  return "?" + params.toString();
}

/** The current address without `task`: the view the panel opened over. */
export function taskPanelClosedHref(search) {
  const params = new URLSearchParams(search || "");
  params.delete("task");
  const query = params.toString();
  return query ? "?" + query : "?";
}

/* ---------- states ---------- */

export function taskPanelLoading(id) {
  return { ...loadingState("task"), id, text: TASK_TEXT.loading(id) };
}

/**
 * Not found: an unknown id is an answer, not an error. `detail` is
 * branchling's own refusal text, shown verbatim.
 */
export function taskNotFound(id, branchlingSaid = null) {
  const shaped = typeof id === "string" && TASK_ID_SHAPE.test(id);
  return {
    view: "task",
    state: "not-found",
    id: String(id),
    title: shaped ? TASK_TEXT.notFoundTitle(id) : TASK_TEXT.notAnIdTitle,
    detail: shaped ? TASK_TEXT.notFoundDetail : TASK_TEXT.notAnIdDetail(String(id).slice(0, 40)),
    branchlingSaid: typeof branchlingSaid === "string" && branchlingSaid.trim() ? branchlingSaid.trim() : null,
    branchlingSaidLabel: TASK_TEXT.branchlingSaid,
  };
}

/**
 * A failed `/api/task/panel` answer. branchling's `no-such-task` refusal is
 * the not-found state; any other refusal stays a refusal, anything else an
 * error (with Try again), from states.mjs like every view.
 */
export function taskPanelFailure(id, body, status) {
  const error = (body && body.error) || {};
  if (error.type === "refusal" && error.refusalKind === "no-such-task") return taskNotFound(id, error.message);
  return { ...fromApiError("task", body, status), id };
}

/* ---------- show: status, priority, blockers ---------- */

function blockerRow(b) {
  return {
    id: String(b.id),
    title: typeof b.title === "string" ? b.title : null,
    status: b.status ?? null,
    statusLabel: b.status ? label(b.status) : null,
    role: statusRole(b.status),
    // branchling's verdicts, never derived from the status name here.
    resolved: b.resolved === true,
    found: b.found !== false,
    note: [b.resolved === true ? "resolved" : "unresolved", b.found === false ? "not found" : null].filter(Boolean).join(" · "),
  };
}

/** What `show` says about one task: the head of the panel. */
export function taskDetailModel(envelope, freshness = {}) {
  if (!envelope || envelope.kind !== "task-show" || typeof envelope.id !== "string") {
    throw new TypeError("taskDetailModel needs a task-show envelope");
  }
  return {
    view: "task",
    state: "ready",
    freshness: freshnessOf(freshness),
    id: envelope.id,
    title: typeof envelope.title === "string" ? envelope.title : null,
    status: envelope.status ?? null,
    statusLabel: envelope.status ? label(envelope.status) : null,
    statusRole: statusRole(envelope.status),
    priority: envelope.priority ?? null,
    priorityRole: priorityRole(envelope.priority),
    file: typeof envelope.file === "string" ? envelope.file : null,
    blocked: envelope.blocked === true,
    blockers: (envelope.blockers || []).filter(b => b && typeof b.id === "string").map(blockerRow),
    elsewhere: Array.isArray(envelope.elsewhere) ? envelope.elsewhere.length : 0,
  };
}

/* ---------- query row: the fields ---------- */

/** The fields shown, in the mockup's order. `kind` says how a surface draws the value. */
const FIELD_ROWS = [
  ["owner", "Owner", "text"],
  ["role", "Role", "text"],
  ["executor", "Executor", "text"],
  ["release", "Release", "text"],
  ["epic", "Epic", "text"],
  ["board", "Board", "text"],
  ["type", "Type", "text"],
  ["estimate", "Estimate", "text"],
  ["labels", "Labels", "list"],
  ["target", "Targets", "list"],
  ["conflict_group", "Conflict group", "list"],
  ["related_docs", "Related docs", "list"],
  ["created", "Created", "text"],
  ["updated", "Updated", "text"],
];

function fieldsOf(row, detail) {
  const fields = [
    { key: "status", label: "Status", kind: "status", value: detail.status, display: detail.statusLabel || TASK_TEXT.none, role: detail.statusRole },
    { key: "priority", label: "Priority", kind: "priority", value: detail.priority, display: detail.priority || TASK_TEXT.none, role: detail.priorityRole },
  ];
  if (!row) return fields;
  for (const [key, name, kind] of FIELD_ROWS) {
    if (kind === "list") {
      const items = Array.isArray(row[key]) ? row[key].filter(v => typeof v === "string" && v) : [];
      fields.push({ key, label: name, kind, value: items, items, display: items.length ? items.join(", ") : TASK_TEXT.none });
    } else {
      const value = str(row[key]);
      fields.push({ key, label: name, kind, value: value || null, display: value || TASK_TEXT.none });
    }
  }
  return fields;
}

/* ---------- log: the history ---------- */

const CHANGE_EMPTY = "(empty)";

function changeText(c) {
  const from = str(c.from) || CHANGE_EMPTY;
  const to = str(c.to) || CHANGE_EMPTY;
  return `${label(str(c.field) || "field")}: ${from} → ${to}`;
}

function messageText(m) {
  const kind = str(m.kind) || "message";
  const text = str(m.text);
  return text ? `${kind}: ${text}` : `${kind} ${str(m.id)}`.trim();
}

/** One exchange of `log --json` as a history entry. */
function historyEntry(x, index) {
  const actor = str(x.actor) || "unknown";
  const source = str(x.source) || "a write";
  const reason = str(x.reason);
  const changes = (Array.isArray(x.changes) ? x.changes : []).filter(c => c && typeof c === "object").map(c => ({
    field: str(c.field),
    from: str(c.from),
    to: str(c.to),
    text: changeText(c),
  }));
  const messages = (Array.isArray(x.messages) ? x.messages : []).filter(m => m && typeof m === "object").map(m => ({
    id: str(m.id),
    kind: str(m.kind),
    text: str(m.text) || null,
    display: messageText(m),
  }));
  return {
    index,
    ts: str(x.ts) || null,
    actor,
    source,
    what: `${actor} · ${source}`,
    // branchling writes the literal "unknown" when a write gave no reason; it
    // is its word, shown as it is.
    reason: reason || null,
    changes,
    events: (Array.isArray(x.events) ? x.events : []).filter(e => typeof e === "string" && e),
    messages,
    kind: messages.some(m => m.kind === "question") ? "question"
      : messages.some(m => m.kind === "decision") ? "decision"
        : changes.length ? "change" : "event",
  };
}

/** The history from a `task-log` envelope, in branchling's order. */
export function historyModel(envelope) {
  if (!envelope || envelope.kind !== "task-log" || !Array.isArray(envelope.exchanges)) {
    throw new TypeError("historyModel needs a task-log envelope");
  }
  const entries = envelope.exchanges.filter(x => x && typeof x === "object").map(historyEntry);
  const total = Number.isInteger(envelope.total) ? envelope.total : entries.length;
  return {
    entries,
    count: entries.length,
    total,
    sliced: entries.length < total,
    note: entries.length < total ? TASK_TEXT.historySlice(entries.length, total) : TASK_TEXT.historyOrder,
    emptyText: TASK_TEXT.historyEmpty,
  };
}

/* ---------- the body: a small, safe markdown subset as plain data ---------- */

/**
 * An href a link may carry, or null. http(s) and relative or anchor links
 * only. Anything with whitespace, a control character or a backslash is
 * refused outright: browsers strip tabs and newlines from a URL before reading
 * its scheme (`java\tscript:` is `javascript:`) and read `\` as `/`.
 * Protocol-relative `//host` is refused too: the scheme is not written.
 */
export function safeHref(href) {
  if (typeof href !== "string") return null;
  const h = href.trim();
  if (!h || h.length > 2048) return null;
  if (/[\u0000- \u007f-\u009f\\]/.test(h)) return null;
  if (h.startsWith("//")) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(h);
  if (scheme) return /^https?$/i.test(scheme[1]) ? h : null;
  // No scheme before the first `/`, `?` or `#`: a relative path or an anchor.
  return h;
}

/**
 * Inline markdown as segments: `{ type: "text" | "code", text }` and
 * `{ type: "link", text, href }`. Only code spans and `[text](href)` links are
 * recognised; everything else (emphasis, raw HTML, images) stays literal text.
 * A link whose href is not safe stays literal text too, so it is visible.
 */
export function markdownInlines(source) {
  const s = String(source ?? "");
  const out = [];
  let text = "";
  const flush = () => { if (text) out.push({ type: "text", text }); text = ""; };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "`") {
      let n = 0;
      while (s[i + n] === "`") n++;
      const fence = "`".repeat(n);
      const end = s.indexOf(fence, i + n);
      if (end !== -1 && s[end + n] !== "`") {
        flush();
        const inner = s.slice(i + n, end);
        out.push({ type: "code", text: /^ .* $/.test(inner) && inner.trim() ? inner.slice(1, -1) : inner });
        i = end + n;
        continue;
      }
      text += fence;
      i += n;
      continue;
    }
    if (ch === "[") {
      const m = /^\[([^\[\]\n]*)\]\(([^()\s]*)(?:\s+"[^"\n]*")?\)/.exec(s.slice(i));
      if (m) {
        const href = safeHref(m[2]);
        if (href && m[1].trim()) {
          flush();
          out.push({ type: "link", text: m[1], href });
          i += m[0].length;
          continue;
        }
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

/**
 * A markdown body as blocks of plain data, for either surface to draw:
 *
 *   { type: "heading", level: 1-6, inlines }
 *   { type: "paragraph", inlines }
 *   { type: "list", ordered, items: [{ depth: 0-3, inlines }] }
 *   { type: "code", lang, text }
 *
 * A small subset on purpose: headings, lists, fenced code, code spans,
 * paragraphs and links. Raw HTML is never interpreted: `<script>` is the text
 * "<script>", to be put on screen through textContent. Everything not in the
 * subset (tables, quotes, emphasis) reads as the text it was written as.
 */
export function markdownBlocks(source) {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let para = null;
  let list = null;
  const endPara = () => { if (para) blocks.push({ type: "paragraph", inlines: markdownInlines(para.join(" ")) }); para = null; };
  const endList = () => { if (list) blocks.push(list); list = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      endPara(); endList();
      const marker = fence[1];
      const body = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const close = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
        if (close.test(lines[j])) break;
        body.push(lines[j]);
      }
      blocks.push({ type: "code", lang: fence[2] || null, text: body.join("\n") });
      i = j;
      continue;
    }
    if (!line.trim()) { endPara(); endList(); continue; }
    const heading = HEADING.exec(line);
    if (heading) {
      endPara(); endList();
      blocks.push({ type: "heading", level: heading[1].length, inlines: markdownInlines(heading[2] || "") });
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      endPara();
      const ordered = /\d/.test(item[2]);
      if (list && list.ordered !== ordered && item[1].length === 0) endList();
      if (!list) list = { type: "list", ordered, items: [] };
      const indent = item[1].replace(/\t/g, "    ").length;
      list.items.push({ depth: Math.min(3, Math.floor(indent / 2)), raw: item[3] });
      continue;
    }
    if (list && /^[ \t]+\S/.test(line)) {
      // A continuation line of the last item.
      const last = list.items[list.items.length - 1];
      last.raw += " " + line.trim();
      continue;
    }
    endList();
    (para ||= []).push(line.trim());
  }
  endPara(); endList();
  for (const block of blocks) {
    if (block.type === "list") block.items = block.items.map(({ depth, raw }) => ({ depth, inlines: markdownInlines(raw) }));
  }
  return blocks;
}

/** The body part of the panel: known (blocks) or not known (a sentence why). */
export function bodyModel(body) {
  if (typeof body !== "string") return { known: false, text: TASK_TEXT.bodyUnavailable, blocks: [] };
  const blocks = markdownBlocks(body);
  return { known: true, text: blocks.length ? null : TASK_TEXT.bodyEmpty, blocks };
}

/* ---------- the whole panel ---------- */

/**
 * @param {object} answer the composed `task-panel` answer from readTask():
 *   `{ kind: "task-panel", composed: true, id, show, log, task, blocks }`,
 *   and `body` (a string) once some read gives one
 * @param {{ stale?: boolean, fetchedAt?: string|null }} [freshness]
 * @param {string} [search] the page's query string, for the links the panel draws
 */
export function taskPanelModel(answer, freshness = {}, search = "") {
  if (!answer || answer.kind !== "task-panel" || typeof answer.id !== "string") {
    throw new TypeError("taskPanelModel needs a task-panel answer");
  }
  const detail = taskDetailModel(answer.show, freshness);
  const row = answer.task && typeof answer.task === "object" && answer.task.id === answer.id ? answer.task : null;
  const history = historyModel(answer.log);
  const link = id => taskPanelHref(search, id);
  const blockedBy = detail.blockers.map(b => ({ ...b, href: link(b.id) }));
  const blocks = (Array.isArray(answer.blocks) ? answer.blocks : [])
    .filter(t => t && typeof t.id === "string" && t.id && t.id !== answer.id)
    .map(t => ({
      id: t.id,
      title: typeof t.title === "string" ? t.title : null,
      status: t.status ?? null,
      statusLabel: t.status ? label(t.status) : null,
      role: statusRole(t.status),
      href: link(t.id),
    }));
  const meta = [];
  if (row && str(row.owner)) meta.push(str(row.owner));
  if (row && str(row.release)) meta.push(`release ${str(row.release)}`);
  if (row && str(row.board)) meta.push(`board ${str(row.board)}`);
  return {
    view: "task",
    state: "ready",
    freshness: detail.freshness,
    id: detail.id,
    title: detail.title || detail.id,
    status: detail.status,
    statusLabel: detail.statusLabel || TASK_TEXT.none,
    statusRole: detail.statusRole,
    priority: detail.priority,
    priorityLabel: detail.priority || TASK_TEXT.none,
    priorityRole: detail.priorityRole,
    meta: meta.join(" · "),
    fieldsKnown: row !== null,
    fields: fieldsOf(row, detail),
    blockers: {
      blocked: detail.blocked,
      blockedBy,
      blocks,
      blockedByEmpty: TASK_TEXT.noBlockers,
      blocksEmpty: TASK_TEXT.noBlocks,
      blocksScope: TASK_TEXT.blocksScope,
    },
    computed: {
      blockedText: detail.blocked ? TASK_TEXT.blockedYes : TASK_TEXT.blockedNo,
      file: detail.file,
      elsewhere: detail.elsewhere,
      elsewhereText: detail.elsewhere ? TASK_TEXT.elsewhere(detail.elsewhere) : null,
    },
    body: bodyModel(answer.body),
    history,
  };
}
