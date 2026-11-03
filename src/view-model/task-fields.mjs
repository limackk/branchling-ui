/**
 * The task panel's field edits (UI-6), after docs/design/mockups/task.html
 * (the pen on a field) and flows.html ("Edit a field · set"). Plain data for
 * both surfaces, pure like the other view models: no `node:` import, no DOM,
 * no markup, no ANSI, only sibling imports.
 *
 * Every edit is ONE `branchling set <ID> <field> <value> [--reason "…"]`
 * through the adapter. Status and owner are not offered: take, done,
 * handoff, release and ask own them (branchling refuses them with
 * `refusalKind: "dedicated"`), so they keep the panel's actions.
 *
 * WHICH FIELDS. EDITABLE_FIELDS is the list branchling 0.3.0's `set` names
 * as editable. No command returns that list as data: `set --help` is prose,
 * and the only other place it appears is the detail line of the refusal for
 * a field `set` does not edit ("editable: title, priority, …"), which is text
 * for a person. So it is written down here, and test/field-edit.test.mjs
 * fails the day the pinned executable lists anything else. A field branchling
 * stops accepting is refused by branchling all the same; nothing here
 * decides whether an edit is allowed, only which pens are drawn.
 *
 * WHICH VALUES. The vocabularies (priorities, types, roles, releases, …) are
 * in config.yaml, which this package may not read, and no command returns
 * them as data (UI-18). So every value is typed as text, and a value outside
 * the vocabulary comes back as branchling's refusal, whose text names the
 * allowed values; it is shown unchanged, the form keeps what was typed, and
 * the person can correct it and send again.
 *
 * THE REASON is optional: `set` takes `--reason` and records it in the
 * history (`unknown` when none is given, branchling's own word). It is
 * required "where reason_required_statuses demands it", which concerns
 * entering a status, and status is not set here; no edit of 0.3.0 was found
 * that requires one. If branchling ever refuses for want of a reason, that
 * refusal is shown and the person adds one and sends again.
 *
 * THE ACTOR is never taken from the page (docs/architecture.md, "The
 * actor"): `actor` in a request is refused by name, and the recorded actor
 * is read back from branchling's answer.
 */

import { taskActionFailure, TASK_ACTIONS_TEXT } from "./task-actions.mjs";
import { TASK_ID_SHAPE } from "./tasks.mjs";

/** The fields `set` edits in branchling 0.3.0, in its own order, with the panel's labels. */
export const EDITABLE_FIELDS = Object.freeze([
  ["title", "Title"],
  ["priority", "Priority"],
  ["type", "Type"],
  ["role", "Role"],
  ["estimate", "Estimate"],
  ["confidence", "Confidence"],
  ["board", "Board"],
  ["epic", "Epic"],
  ["release", "Release"],
  ["labels", "Labels"],
  ["target", "Targets"],
  ["blocked_by", "Blocked by"],
  ["blocks", "Blocks (declared)"],
  ["executor", "Executor"],
  ["related_docs", "Related docs"],
  ["conflict_group", "Conflict group"],
].map(([key, label]) => Object.freeze({ key, label })));

const EDITABLE_KEYS = EDITABLE_FIELDS.map(f => f.key);

/** Limits on a request, checked before branchling is called. */
export const FIELD_EDIT_LIMITS = { id: 64, field: 64, value: 2000, reason: 2000 };

/** The route an edit is POSTed to. */
export const FIELD_EDIT_PATH = "/api/task/field";

/** The only keys a request may carry. */
const KEYS = ["id", "field", "value", "reason"];

/** A field name as branchling spells them: lowercase words joined by `_`. */
const FIELD_SHAPE = /^[a-z][a-z0-9_]*$/;

export const FIELD_EDIT_TEXT = {
  sectionNote: "edits run",
  edit: (label, display) => `${label}: ${display}. Edit`,
  title: (label, id) => `Change ${label.toLowerCase()} of ${id}`,
  valueLabel: "New value",
  valueHint: "Checked by branchling against this backlog's config.yaml. A list takes its items comma-separated; an empty value clears a field that may be empty.",
  valueUnknown: "branchling does not report this field's current value in any read, so the box starts empty.",
  reasonLabel: "Why",
  reasonOptional: "(optional, recorded in history)",
  reasonHint: "Recorded with the change. If branchling asks for a reason, add one here and save again.",
  save: "Save",
  cancel: "Cancel",
  sending: "Running branchling…",
  changed: (label, from, to) => `${label}: ${from} → ${to}`,
  recorded: (id, label) => `${label} of ${id} is changed.`,
  unchanged: (id, label, value) => `${label} of ${id} already was ${value}; branchling recorded nothing.`,
  recordedActor: TASK_ACTIONS_TEXT.recordedActor,
  actorNote: TASK_ACTIONS_TEXT.actorNote,
  actorUnknown: TASK_ACTIONS_TEXT.actorUnknown,
  empty: "(empty)",
  notReported: "not reported",
};

/** The panel label of a field, or the field's own name with spaces. */
export function fieldLabel(key) {
  const known = EDITABLE_FIELDS.find(f => f.key === key);
  return known ? known.label : String(key).replace(/_/g, " ");
}

function badText(value, name, max) {
  if (value.length > max) return `${name} is longer than ${max} characters.`;
  if (value.startsWith("-")) return `${name} cannot start with "-": branchling would read it as a flag.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return `${name} cannot contain control characters.`;
  return null;
}

/**
 * The one shape an edit may have, checked identically on the page and on the
 * server: `{ id, field, value, reason? }`. `value` may be empty (it clears);
 * `value` and `reason` are trimmed. The field is checked for its shape only:
 * whether branchling edits it is branchling's answer (status and owner are
 * refused by it, `dedicated`). Every message names the input it is about, as
 * `field`, so the page can mark it.
 *
 * @returns {{ ok: true, value: { id, field, value, reason? } } | { ok: false, field: string|null, message: string }}
 */
export function validateFieldEdit(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, field: null, message: "The request must be a JSON object." };
  for (const key of Object.keys(input)) {
    if (key === "actor") return { ok: false, field: null, message: "The actor is not taken from the page: branchling resolves it from the environment of the person who started the server." };
    if (!KEYS.includes(key)) return { ok: false, field: null, message: `Unknown field "${key}".` };
  }
  if (typeof input.id !== "string" || !TASK_ID_SHAPE.test(input.id) || input.id.length > FIELD_EDIT_LIMITS.id) {
    return { ok: false, field: "id", message: `${JSON.stringify(String(input.id ?? "").slice(0, 40))} is not a task id.` };
  }
  if (typeof input.field !== "string" || !FIELD_SHAPE.test(input.field) || input.field.length > FIELD_EDIT_LIMITS.field) {
    return { ok: false, field: "field", message: `${JSON.stringify(String(input.field ?? "").slice(0, 40))} is not a field name.` };
  }
  if (typeof input.value !== "string") return { ok: false, field: "value", message: "The value must be text; an empty value clears the field." };
  const value = input.value.trim();
  const valueProblem = badText(value, "The value", FIELD_EDIT_LIMITS.value);
  if (valueProblem) return { ok: false, field: "value", message: valueProblem };
  const out = { id: input.id, field: input.field, value };
  if (input.reason !== undefined && input.reason !== null) {
    if (typeof input.reason !== "string") return { ok: false, field: "reason", message: "The reason must be text." };
    const reason = input.reason.trim();
    const reasonProblem = badText(reason, "The reason", FIELD_EDIT_LIMITS.reason);
    if (reasonProblem) return { ok: false, field: "reason", message: reasonProblem };
    if (reason) out.reason = reason;
  }
  return { ok: true, value: out };
}

/**
 * The command the edit dialog names, as parts for the page to draw (an `arg`
 * part is what the person fills in). Never an `--actor`.
 */
export function fieldCommand(id, field, value = "", reason = "") {
  const v = String(value ?? "").trim();
  const r = String(reason ?? "").trim();
  const quote = s => JSON.stringify(s);
  const parts = [{ text: `branchling set ${id} ${field} ` }, { text: v ? (/[\s"'`$\\,;&|<>()]/.test(v) ? quote(v) : v) : "\"\"", arg: true }];
  if (r) parts.push({ text: " --reason " }, { text: quote(r), arg: true });
  return { parts, text: parts.map(p => p.text).join("") };
}

const str = value => (typeof value === "string" ? value : "");

function listOf(value) {
  return Array.isArray(value) ? value.filter(v => typeof v === "string" && v) : null;
}

/**
 * The fields a pen is drawn for, with what the edit box starts with, from the
 * composed `task-panel` answer (readTask). `title` and `priority` come from
 * `show`, the rest from the task's `query` row. `confidence` and the declared
 * `blocks` are in no read of 0.3.0 (`query` rows leave them out, and the
 * panel's "Blocks" is the other direction, `query --blocked-by`), so they are
 * `known: false` and start empty.
 *
 *   [{ key, label, known, list, current, display }]
 */
export function fieldEdits(answer) {
  if (!answer || answer.kind !== "task-panel" || typeof answer.id !== "string") {
    throw new TypeError("fieldEdits needs a task-panel answer");
  }
  const show = answer.show || {};
  const row = answer.task && typeof answer.task === "object" && answer.task.id === answer.id ? answer.task : null;
  return EDITABLE_FIELDS.map(({ key, label }) => {
    let raw;
    if (key === "title" || key === "priority") raw = show[key];
    else if (row && Object.prototype.hasOwnProperty.call(row, key)) raw = row[key];
    const list = listOf(raw);
    const known = raw !== undefined && raw !== null;
    const current = list ? list.join(", ") : str(raw);
    return {
      key,
      label,
      known,
      list: list !== null,
      current,
      display: !known ? FIELD_EDIT_TEXT.notReported : current || FIELD_EDIT_TEXT.empty,
    };
  });
}

function shown(value) {
  if (Array.isArray(value)) return value.length ? value.map(String).join(", ") : FIELD_EDIT_TEXT.empty;
  return value === null || value === undefined || value === "" ? FIELD_EDIT_TEXT.empty : String(value);
}

/**
 * What branchling answered a successful `set` with, as a sentence the person
 * can check, the recorded actor in it. `changes` is the history entries
 * branchling wrote: none when the value already was that.
 *
 * @param {object} result the `task-set` envelope the route answered with, unchanged
 */
export function fieldEditRecorded(result) {
  const r = result || {};
  const id = str(r.id) || "the task";
  const label = fieldLabel(str(r.field) || "field");
  const actor = str(r.actor) || null;
  const changes = (Array.isArray(r.changes) ? r.changes : []).filter(c => c && typeof c === "object").map(c => ({
    field: str(c.field),
    from: c.from ?? null,
    to: c.to ?? null,
    reason: str(c.reason) || null,
    text: FIELD_EDIT_TEXT.changed(fieldLabel(str(c.field) || r.field), shown(c.from), shown(c.to)),
  }));
  return {
    view: "task",
    state: "recorded",
    action: "set",
    taskId: str(r.id) || null,
    field: str(r.field) || null,
    actor,
    actorKnown: actor !== null,
    actorText: actor !== null ? `${FIELD_EDIT_TEXT.recordedActor} ${actor}. ${FIELD_EDIT_TEXT.actorNote}` : FIELD_EDIT_TEXT.actorUnknown,
    message: changes.length ? FIELD_EDIT_TEXT.recorded(id, label) : FIELD_EDIT_TEXT.unchanged(id, label, shown(r.value)),
    changes,
    note: null,
  };
}

/**
 * A failed edit, built the way the panel's actions build theirs
 * (taskActionFailure): a refusal is branchling's text unchanged with its
 * detail lines and kind (a value outside the vocabulary names the allowed
 * ones; status and owner name the commands that own them) and says nothing
 * was written; anything else is an error from states.mjs.
 */
export function fieldEditFailure(body, status) {
  return taskActionFailure("set", body, status);
}

/** Whether `key` is one of the fields a pen is drawn for. */
export const isEditableField = key => EDITABLE_KEYS.includes(key);
