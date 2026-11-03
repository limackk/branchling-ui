/**
 * Release planning (UI-8), after docs/design/mockups/releases.html (the
 * Planning tab: "Declare a release" and "Plan tasks for <release>"). Plain
 * data for both surfaces, pure like the other view models: no `node:`
 * import, no DOM, no markup, no ANSI, only sibling imports.
 *
 * Two writes, each a branchling command through the adapter:
 *
 *   declare   `declare releases <name> --reason "…" [--ref <ref>]`
 *             POST /api/release/declare (src/views/release.mjs)
 *   plan      `set <ID> release <name>`, one per task, through UI-6's own
 *             POST /api/task/field: there is no second write path for `set`
 *
 * and the comparison of plan with shipped is the release view's own read,
 * `deploy status --release <name>`, which the page already renders.
 *
 * WHICH RELEASES ARE DECLARED. No read of branchling 0.3.0 returns
 * `releases:` as data: not `deploy status` (its `release` key is the one
 * named by `--release`, with `current`, the release it judges current), not
 * `stats`, `query`, `doctor` (prose only, inside a check's detail), `plan`,
 * `show`, `log`, `audit` or `where`. So this package never shows a list
 * that claims to be the declared releases. What it can say from
 * branchling's own data:
 *
 *   - a release IS declared when `deploy status --release <name>` (and
 *     `query --release <name>`) answer with an envelope; an undeclared one
 *     is a usage error, which the release view turns into its rejected state;
 *   - the releases SEEN: the `release` of the active tasks' `query` rows,
 *     `release.current` of the last `deploy status --release`, and every
 *     name `declare` answered with on this page. That is what the release
 *     box suggests, labelled as seen, never as declared.
 *
 * THE ACTOR is never taken from the page (docs/architecture.md, "The
 * actor"): `actor` in a request is refused by name.
 */

import { fromApiError } from "./states.mjs";
import { TASK_ACTIONS_TEXT } from "./task-actions.mjs";

/** The route a declaration is POSTed to. */
export const DECLARE_PATH = "/api/release/declare";

/** Limits on a request, checked before branchling is called. */
export const DECLARE_LIMITS = { name: 64, reason: 2000, ref: 256 };

/** The only keys a request may carry. */
const KEYS = ["name", "reason", "ref"];

export const PLANNING_TEXT = {
  heading: "Planning",
  declareHeading: "Declare a release",
  nameLabel: "Name",
  nameHint: "Added last to releases: in this backlog's config.yaml; comments in the file are kept. branchling checks the name (a lowercase slug) and refuses one already declared.",
  refLabel: "Shipped at",
  refOptional: "(optional)",
  refHint: "Only for a release that has already shipped: the ref or tag where it ends.",
  reasonLabel: "Why",
  reasonRequired: "(required, written above the entry)",
  reasonHint: "branchling writes it as a comment above the new entry: the record of a configuration change is that file's diff.",
  declare: "Declare release",
  sending: "Running branchling…",
  declared: (name, file) => `Release ${name} is declared${file ? ` in ${file}` : ""}.`,
  declaredRef: ref => `Shipped at ${ref}.`,
  declaredNext: "It is selected now: the comparison above and the task list here are for it.",
  refusalTitle: "branchling declined",
  reasonCode: "Refusal kind",
  nothingWritten: TASK_ACTIONS_TEXT.nothingWritten,
  changeIsHandEdit: "Changing or removing a release that exists stays a hand edit of config.yaml.",

  planHeading: name => `Plan tasks for ${name}`,
  planNone: "Choose a release above, or declare one, to plan tasks for it.",
  planNote: "each runs",
  planLoading: "Loading the active tasks…",
  planEmpty: "There are no active tasks to plan.",
  planScope: "Active tasks, as branchling's query lists them. A box that is ticked is planned for this release; ticking or clearing one plans it or takes it out.",
  planElsewhere: release => `now planned for ${release}`,
  planReasonLabel: "Why",
  planReasonOptional: "(optional, recorded in each task's history)",
  planApply: count => (count === 1 ? "Apply 1 change" : `Apply ${count} changes`),
  planNothing: "Nothing to apply: tick or clear a box first.",
  planHistory: "one history record per task",
  planRunning: (done, total) => `Running branchling set… ${done} of ${total}`,
  planRecorded: (id, name) => (name ? `${id} is planned for ${name}.` : `${id} is planned for no release.`),
  planUnchanged: id => `${id} already was; branchling recorded nothing.`,
  planFailed: id => `${id} was not changed.`,
  planStopped: "The remaining changes were not sent.",
  recordedActor: TASK_ACTIONS_TEXT.recordedActor,
  actorNote: TASK_ACTIONS_TEXT.actorNote,

  seenLabel: "Releases seen",
  seenNote: "Seen on active tasks, in the last comparison and declared on this page. branchling gives no list of every declared release as data yet.",
};

function badText(value, name, max) {
  if (value.length > max) return `${name} is longer than ${max} characters.`;
  if (value.startsWith("-")) return `${name} cannot start with "-": branchling would read it as a flag.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return `${name} cannot contain control characters.`;
  return null;
}

/**
 * The one shape a declaration may have, checked identically on the page and
 * on the server: `{ name, reason, ref? }`, trimmed. The reason is required
 * here as well as by branchling (it refuses an empty one, `usage`). The name
 * is checked for length, a leading "-" and control characters only: whether
 * it is a release name, and whether it is declared already, is branchling's
 * answer (`malformed`, `duplicate`). Every message names the input it is
 * about, as `field`, so the page can mark it.
 *
 * @returns {{ ok: true, value: { name, reason, ref? } } | { ok: false, field: string|null, message: string }}
 */
export function validateDeclare(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, field: null, message: "The request must be a JSON object." };
  for (const key of Object.keys(input)) {
    if (key === "actor") return { ok: false, field: null, message: "The actor is not taken from the page: branchling resolves it from the environment of the person who started the server." };
    if (!KEYS.includes(key)) return { ok: false, field: null, message: `Unknown field "${key}".` };
  }
  if (typeof input.name !== "string" || !input.name.trim()) return { ok: false, field: "name", message: "A release name is required." };
  const name = input.name.trim();
  const nameProblem = badText(name, "The name", DECLARE_LIMITS.name);
  if (nameProblem) return { ok: false, field: "name", message: nameProblem };
  if (typeof input.reason !== "string" || !input.reason.trim()) return { ok: false, field: "reason", message: "A reason is required: branchling writes it above the entry." };
  const reason = input.reason.trim();
  const reasonProblem = badText(reason, "The reason", DECLARE_LIMITS.reason);
  if (reasonProblem) return { ok: false, field: "reason", message: reasonProblem };
  const out = { name, reason };
  if (input.ref !== undefined && input.ref !== null) {
    if (typeof input.ref !== "string") return { ok: false, field: "ref", message: "The ref must be text." };
    const ref = input.ref.trim();
    const refProblem = badText(ref, "The ref", DECLARE_LIMITS.ref);
    if (refProblem) return { ok: false, field: "ref", message: refProblem };
    if (ref) out.ref = ref;
  }
  return { ok: true, value: out };
}

const quote = s => JSON.stringify(s);
const word = s => (/[\s"'`$\\,;&|<>()]/.test(s) ? quote(s) : s);

/**
 * The command the declare form names, as parts for the page to draw (an
 * `arg` part is what the person fills in). Never an `--actor`.
 */
export function declareCommand(name = "", reason = "", ref = "") {
  const n = String(name ?? "").trim();
  const r = String(reason ?? "").trim();
  const f = String(ref ?? "").trim();
  const parts = [
    { text: "branchling declare releases " },
    { text: n ? word(n) : "<name>", arg: true },
    { text: " --reason " },
    { text: r ? quote(r) : "\"…\"", arg: true },
  ];
  if (f) parts.push({ text: " --ref " }, { text: word(f), arg: true });
  return { parts, text: parts.map(p => p.text).join("") };
}

/** The command one planning change runs: `set <ID> release <name>`. */
export function planCommand(id = "<ID>", name = "") {
  const n = String(name ?? "").trim();
  return `branchling set ${id} release ${n ? word(n) : "\"\""}`;
}

const str = value => (typeof value === "string" ? value : "");

/**
 * What branchling answered a successful `declare` with, as sentences the
 * person can check.
 *
 * @param {object} result the `vocabulary-declare` envelope, unchanged
 */
export function declareRecorded(result) {
  const r = result || {};
  const entry = r.entry && typeof r.entry === "object" ? r.entry : {};
  const name = str(r.name) || str(entry.name);
  const ref = str(entry.ref) || null;
  return {
    view: "release",
    state: "recorded",
    action: "declare",
    name,
    ref,
    reason: str(r.reason) || null,
    file: str(r.file) || null,
    message: PLANNING_TEXT.declared(name, str(r.file) || null),
    refText: ref ? PLANNING_TEXT.declaredRef(ref) : null,
    next: PLANNING_TEXT.declaredNext,
  };
}

/**
 * A failed declaration: a refusal keeps branchling's text unchanged, with
 * its detail lines and kind (`duplicate` says changing an entry is a hand
 * edit, `malformed` says what a release name is); anything else is an error
 * from states.mjs. The form keeps what was typed either way.
 */
export function declareFailure(body, status) {
  const model = fromApiError("release", body, status);
  if (model.state !== "refusal") return { ...model, action: "declare", details: [] };
  const envelope = body && body.error && body.error.envelope;
  return {
    ...model,
    action: "declare",
    title: PLANNING_TEXT.refusalTitle,
    details: envelope && Array.isArray(envelope.details) ? envelope.details.map(String) : [],
    refusalKindText: model.refusalKind ? `${PLANNING_TEXT.reasonCode}: ${model.refusalKind}` : null,
    nothingWritten: PLANNING_TEXT.nothingWritten,
  };
}

/**
 * The tasks a release can be planned for, from a `task-list` envelope
 * (`query --json`, the active tasks), for the release `name`.
 *
 *   { release, state, tasks: [{ id, title, status, release, planned, elsewhere, elsewhereText }] }
 *
 * `planned` is whether the row's `release` is this one; `elsewhere` names
 * another release the task is planned for now, which a tick replaces.
 */
export function planningModel(list, name) {
  const release = String(name ?? "").trim();
  if (!list || list.kind !== "task-list") throw new TypeError("planningModel needs a task-list envelope");
  const rows = Array.isArray(list.tasks) ? list.tasks.filter(t => t && typeof t.id === "string" && t.id) : [];
  const tasks = rows.map(t => {
    const current = str(t.release);
    return {
      id: t.id,
      title: str(t.title),
      status: str(t.status) || null,
      statusLabel: str(t.status).replace(/_/g, " "),
      release: current,
      planned: release !== "" && current === release,
      elsewhere: current && current !== release ? current : null,
      elsewhereText: current && current !== release ? PLANNING_TEXT.planElsewhere(current) : null,
    };
  });
  return { view: "release", release: release || null, state: tasks.length ? "ready" : "empty", tasks };
}

/**
 * The `set` calls a planning form asks for: one per task whose box differs
 * from what the read said. A tick plans it for `name`; a cleared box takes
 * it out of `name` (an empty value, which clears the field).
 *
 * @param {{ tasks: Array<{ id, planned }> }} model planningModel's answer
 * @param {Iterable<string>} ticked the ids whose box is ticked now
 * @returns {Array<{ id, field: "release", value }>}
 */
export function planChanges(model, ticked, name) {
  const on = new Set(ticked);
  const release = String(name ?? "").trim();
  const out = [];
  for (const task of (model && model.tasks) || []) {
    const now = on.has(task.id);
    if (now === task.planned) continue;
    out.push({ id: task.id, field: "release", value: now ? release : "" });
  }
  return out;
}

/**
 * The releases this page has SEEN, sorted, never presented as the declared
 * list (see the header): the `release` of task rows, `current` and `name` of
 * a `release-status` envelope's `release`, and names declared on the page.
 */
export function seenReleases({ list, status, declared = [] } = {}) {
  const seen = new Set();
  const add = v => { if (typeof v === "string" && v.trim()) seen.add(v.trim()); };
  if (list && Array.isArray(list.tasks)) for (const t of list.tasks) add(t && t.release);
  const rel = status && status.release && typeof status.release === "object" ? status.release : null;
  if (rel) { add(rel.name); add(rel.current); }
  for (const name of declared) add(name);
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
