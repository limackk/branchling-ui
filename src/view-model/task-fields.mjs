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
 * WHICH FIELDS. branchling says, as data: `set --fields --json` (TL-543)
 * lists every field `set` edits, in its own order, each with whether it is
 * a list, whether it may be cleared, the config.yaml key its value must come
 * from, a key its values are only suggested from, and a vocabulary the tool
 * fixes itself (executor's human | agent). readTask composes that list into
 * the panel's answer as `fields`, and a pen is drawn for each entry and for
 * nothing else; no list of field names is kept here. FIELD_LABELS is
 * presentation only: a field it does not name is still offered, under its
 * own name, and a label for a field branchling stops reporting draws
 * nothing. A build before TL-543 cannot describe its fields (`fields: null`),
 * and the panel then says so and draws no pens rather than guessing a list.
 *
 * WHICH VALUES. The box starts from the task's current value, which `show`
 * and the task's `query` row both carry for every field `set` edits since
 * TL-543 (confidence and the declared blocks included).
 *
 * A CLOSED VOCABULARY IS A CHOICE (UI-43). `set --fields` names, for each
 * field, the config.yaml key its value must come from (`vocabulary`) or is
 * only suggested from (`suggestions`); readTask composes branchling's
 * `vocabulary` envelope (UI-18) into the answer, and that envelope is keyed
 * by the same config.yaml keys. So a field whose key the envelope answers
 * offers exactly the declared values as a choice (`control: "select"`, or
 * `"checkboxes"` for a list), and a field whose values the tool fixes itself
 * (executor's `values`) does too. A suggested key (estimates, labels) keeps
 * the text box with the declared values as suggestions. Free text stays
 * wherever the executable has no vocabulary to give: a field without a key,
 * a key the envelope does not carry, or a build without the `vocabulary`
 * command (`vocabulary: null`). A current value the backlog no longer
 * declares is still offered, marked, so opening the form never changes it.
 * Every value is still judged by branchling: a value outside the vocabulary
 * is refused as `unknown-value`, naming the declared values, and the form
 * says which input to fix, keeps what was chosen, and lets the person send
 * again.
 *
 * THE REASON is optional: `set` takes `--reason` and records it in the
 * history (`unknown` when none is given, branchling's own word). When the
 * backlog demands one, branchling refuses with `reason-required`, and the
 * form marks the reason box rather than the value.
 *
 * THE ACTOR is never taken from the page (docs/architecture.md, "The
 * actor"): `actor` in a request is refused by name, and the recorded actor
 * is read back from branchling's answer.
 */

import { taskActionFailure, TASK_ACTIONS_TEXT } from "./task-actions.mjs";
import { TASK_ID_SHAPE } from "./tasks.mjs";

/**
 * The panel's names for the fields `set` edits. Presentation, not
 * membership: which fields are offered is `set --fields` (see the header).
 * `blocks` is "declared" because the panel's Blocks section is the other
 * direction, the tasks naming this one in their `blocked_by`.
 */
export const FIELD_LABELS = Object.freeze({
  title: "Title",
  priority: "Priority",
  type: "Type",
  role: "Role",
  estimate: "Estimate",
  confidence: "Confidence",
  board: "Board",
  epic: "Epic",
  release: "Release",
  labels: "Labels",
  target: "Targets",
  blocked_by: "Blocked by",
  blocks: "Blocks (declared)",
  executor: "Executor",
  related_docs: "Related docs",
  conflict_group: "Conflict group",
});

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
  valueHint: "Checked by branchling against this backlog's config.yaml.",
  listHint: "A list: items comma-separated.",
  clearableHint: "An empty value clears it.",
  requiredHint: "It may not be empty.",
  valuesHint: values => `One of: ${values.join(", ")}.`,
  choiceHint: list => (list ? "Tick the values this backlog declares." : "Choose one of the values this backlog declares."),
  noneDeclared: "This backlog declares no values for it.",
  suggestedHint: values => `Declared: ${values.join(", ")}; another value may be typed.`,
  undeclared: value => `${value} (not declared)`,
  valueUnknown: "branchling did not report this field's current value, so the box starts empty.",
  unavailable: "This build of branchling cannot describe the fields its set command edits (set --fields), so no field can be edited here. A newer branchling can.",
  unknownValue: (value, label, declared) => declared.length
    ? `${label} cannot be "${value}" in this backlog. Use one of: ${declared.join(", ")}.`
    : `${label} cannot be "${value}" in this backlog, which declares no values for it.`,
  reasonRequired: "branchling requires a reason for this change. Write one here and save again.",
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

/** The panel label of a field, or the field's own name, capitalised, with spaces. */
export function fieldLabel(key) {
  const name = String(key);
  if (Object.prototype.hasOwnProperty.call(FIELD_LABELS, name)) return FIELD_LABELS[name];
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function badText(value, name, max, { leadingDash = false } = {}) {
  if (value.length > max) return `${name} is longer than ${max} characters.`;
  if (!leadingDash && value.startsWith("-")) return `${name} cannot start with "-": branchling would read it as a flag.`;
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
  const valueProblem = badText(value, "The value", FIELD_EDIT_LIMITS.value, { leadingDash: true });
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

const own = (object, key) => Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);

/** What the value box says under itself, from branchling's description of the field. */
function valueHint(field, known) {
  const parts = [];
  if (!known) parts.push(FIELD_EDIT_TEXT.valueUnknown);
  parts.push(FIELD_EDIT_TEXT.valueHint);
  if (field.list) parts.push(FIELD_EDIT_TEXT.listHint);
  if (field.values && field.values.length) {
    parts.push(FIELD_EDIT_TEXT.valuesHint(field.values));
  } else if (field.choices) {
    parts.push(field.choices.length ? FIELD_EDIT_TEXT.choiceHint(field.list) : FIELD_EDIT_TEXT.noneDeclared);
  } else if (field.suggested && field.suggested.length) {
    parts.push(FIELD_EDIT_TEXT.suggestedHint(field.suggested));
  }
  parts.push(field.clearable ? FIELD_EDIT_TEXT.clearableHint : FIELD_EDIT_TEXT.requiredHint);
  return parts.join(" ");
}

/**
 * The fields a pen is drawn for, with what the edit box starts with, from the
 * composed `task-panel` answer (readTask): one entry per field branchling's
 * `set --fields` reported (`answer.fields`), in its order, and no other. The
 * current value comes from `show`, else from the task's `query` row; a field
 * neither carries is `known: false` and starts empty. `fields: null` (a build
 * before TL-543) gives no pens; fieldEditsNote says why.
 *
 *   [{ key, label, known, list, clearable, vocabulary, suggestions, values,
 *      choices, suggested, control, options, current, display, hint }]
 *
 * `choices` is the closed list of declared values (null: free text),
 * `suggested` the declared values of a suggestions key (null: none),
 * `control` one of "text", "select", "checkboxes", and `options` the
 * choice's entries, `[{ value, label, selected, declared }]`, empty for text.
 */
export function fieldEdits(answer) {
  if (!answer || answer.kind !== "task-panel" || typeof answer.id !== "string") {
    throw new TypeError("fieldEdits needs a task-panel answer");
  }
  if (answer.fields === null) return [];
  if (!Array.isArray(answer.fields)) throw new TypeError("fieldEdits needs the fields set --fields reported, or null");
  const show = answer.show || {};
  const row = answer.task && typeof answer.task === "object" && answer.task.id === answer.id ? answer.task : null;
  return answer.fields.filter(f => f && typeof f.name === "string" && f.name).map(f => {
    const key = f.name;
    const raw = own(show, key) ? show[key] : own(row, key) ? row[key] : undefined;
    const list = listOf(raw);
    const known = raw !== undefined && raw !== null;
    const current = list ? list.join(", ") : str(raw);
    const values = Array.isArray(f.values) ? f.values.filter(v => typeof v === "string" && v) : null;
    const vocabularyKey = str(f.vocabulary) || null;
    const suggestionsKey = str(f.suggestions) || null;
    const choices = values || declaredValues(answer.vocabulary, vocabularyKey);
    const suggested = declaredValues(answer.vocabulary, suggestionsKey);
    const control = choices ? (f.list === true ? "checkboxes" : "select") : "text";
    const field = {
      key,
      label: fieldLabel(key),
      known,
      list: f.list === true,
      clearable: f.clearable === true,
      vocabulary: vocabularyKey,
      suggestions: suggestionsKey,
      values,
      choices,
      suggested,
      control,
      options: control === "text" ? [] : choiceOptions(choices, list || (current ? [current] : []), control === "select" && f.clearable === true),
      current,
      display: !known ? FIELD_EDIT_TEXT.notReported : current || FIELD_EDIT_TEXT.empty,
    };
    return { ...field, hint: valueHint(field, known) };
  });
}

/**
 * The values a config.yaml key declares, as the `vocabulary` envelope
 * reports them: a list of names, or entries named by `slug` (boards) or
 * `name` (releases, deploy targets). Null when there is no key, no envelope
 * (a build without the command), or the envelope does not carry that key:
 * then nothing is known and the box stays free text. An empty list is a
 * real answer, "this backlog declares none".
 */
export function declaredValues(vocabulary, key) {
  if (!key || !vocabulary || typeof vocabulary !== "object" || !own(vocabulary, key) || !Array.isArray(vocabulary[key])) return null;
  const out = [];
  for (const entry of vocabulary[key]) {
    const name = typeof entry === "string" ? entry : entry && typeof entry === "object" ? str(entry.slug) || str(entry.name) : "";
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * The entries of a choice: an empty entry first when the field may be
 * cleared (a select only; unticking every box clears a list), then the
 * declared values in declared order, then any current value the backlog
 * does not declare, marked, so the form starts from what the task holds.
 */
function choiceOptions(choices, current, clearable) {
  const options = [];
  if (clearable) options.push({ value: "", label: FIELD_EDIT_TEXT.empty, selected: current.length === 0, declared: true });
  for (const value of choices) options.push({ value, label: value, selected: current.includes(value), declared: true });
  for (const value of current) {
    if (!choices.includes(value)) options.push({ value, label: FIELD_EDIT_TEXT.undeclared(value), selected: true, declared: false });
  }
  return options;
}

/** The value a choice sends: the selected entries' values, comma-separated for a list. */
export function choiceValue(options) {
  return (Array.isArray(options) ? options : []).filter(o => o && o.selected && o.value).map(o => o.value).join(", ");
}

/** The sentence the Fields section shows when no field can be edited with this build, else null. */
export function fieldEditsNote(answer) {
  return answer && answer.kind === "task-panel" && answer.fields === null ? FIELD_EDIT_TEXT.unavailable : null;
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
 * detail lines and kind, and says nothing was written; anything else is an
 * error from states.mjs.
 *
 * Two refusals name the input to fix, as `fix: { field, message, declared }`
 * (`field` is the form's input, `value` or `reason`), so the form can mark
 * that box instead of only showing the refusal above it:
 *
 *   unknown-value    a value outside the field's vocabulary (TL-543), with
 *                    `rejected: { field, value }` and `declared`, the values
 *                    it accepts
 *   reason-required  the backlog demands a reason for this change
 *
 * Every other refusal has `fix: null`; branchling's text says what is wrong.
 */
export function fieldEditFailure(body, status) {
  const model = taskActionFailure("set", body, status);
  if (model.state !== "refusal") return model;
  const envelope = (body && body.error && body.error.envelope) || {};
  let fix = null;
  if (model.refusalKind === "unknown-value") {
    const rejected = envelope.rejected && typeof envelope.rejected === "object" ? envelope.rejected : {};
    const declared = Array.isArray(envelope.declared) ? envelope.declared.filter(v => typeof v === "string") : [];
    const field = str(rejected.field) || str(envelope.field);
    fix = { field: "value", message: FIELD_EDIT_TEXT.unknownValue(str(rejected.value), fieldLabel(field || "value"), declared), declared };
  } else if (model.refusalKind === "reason-required") {
    fix = { field: "reason", message: FIELD_EDIT_TEXT.reasonRequired, declared: [] };
  }
  return { ...model, fix };
}
