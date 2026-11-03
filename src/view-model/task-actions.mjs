/**
 * The task panel's actions (UI-30): take, release ("return to the queue") and
 * handoff, after docs/design/mockups/flows.html. Plain data for both
 * surfaces, pure like the other view models: no `node:` import, no DOM, no
 * markup, no ANSI, only sibling imports.
 *
 * What it decides, so no surface has to:
 *   - the shape of each action's request (`validateTaskAction`), shared by the
 *     page and the server's routes, so both refuse the same input with the
 *     same sentence before branchling is spawned. Only `id`, `reason` and
 *     `role` exist. `actor` is refused by name: the page cannot vouch for who
 *     sits in front of it, so branchling resolves the actor. `take-over`,
 *     `probe`, `with`, `to-owner`, `status` and anything else are unknown
 *     fields: the panel offers none of them (a take-over crosses somebody
 *     else's claim and is left to the CLI).
 *   - the command each dialog names (`actionCommand`), never with `--actor`.
 *   - what branchling recorded (`taskActionRecorded`), the actor included,
 *     read from what branchling printed: `take`'s lock and owner, `handoff`'s
 *     comment, and for `release`, whose envelope names no actor, the history
 *     exchange that carries the release's comment id.
 *   - a failure (`taskActionFailure`): a refusal keeps branchling's text
 *     unchanged and its detail lines; a role branchling does not know is the
 *     `rejected` state with branchling's message verbatim.
 *
 * ROLES. Which roles a backlog declares is `roles:` in config.yaml, which
 * this package may not read, and no read of branchling 0.2 reports it as
 * data. So the role is typed, passed through, and branchling's own rejection
 * (which names the declared roles) is shown unchanged.
 */

import { fromApiError, rejectedInputState } from "./states.mjs";
import { TASK_ID_SHAPE } from "./tasks.mjs";

export const TASK_ACTIONS = ["take", "release", "handoff"];

/** Limits on a request, checked before branchling is called. */
export const ACTION_LIMITS = { id: 64, reason: 2000, role: 64 };

/** The fields each action takes. Nothing else is accepted. */
const FIELDS = { take: ["id"], release: ["id", "reason"], handoff: ["id", "role", "reason"] };

export const TASK_ACTIONS_TEXT = {
  heading: "Actions",
  actorNote: "branchling records who acted from $BACKLOG_ACTOR or your user config, and uses its own default actor when neither is set.",
  cancel: "Cancel",
  close: "Close",
  nothingWritten: "Nothing was written.",
  refusalTitle: "branchling declined",
  reasonCode: "Refusal kind",
  roleLabel: "To role",
  roleHint: "A role declared under roles: in this backlog's config.yaml. branchling refuses any other.",
  reasonLabel: "Why",
  sending: "Running branchling…",
  recordedActor: "Recorded as",
  actorUnknown: "branchling did not report who it recorded.",
  take: {
    button: "Take",
    title: id => `Take ${id}?`,
    explain: "branchling reserves it for whoever started this interface and sets it in progress. Agents running next will skip it.",
    submit: "Take it",
  },
  release: {
    button: "Return to queue",
    title: id => `Return ${id} to the queue?`,
    explain: "branchling clears the owner and the reservation and puts the task back in the queue. Only the one who holds it can do this.",
    reasonHint: "branchling requires a reason: a task put down without one is abandoned, not released.",
    submit: "Return to queue",
  },
  handoff: {
    button: "Hand off",
    title: id => `Hand off ${id}`,
    explain: "The task asks for another role. branchling clears the owner and the reservation, and records the reason as a comment the next person reads first.",
    reasonHint: "A handoff needs a reason. It is what the next person reads first.",
    submit: "Hand off",
  },
};

function badWord(value, name, max) {
  if (typeof value !== "string" || !value.trim()) return `${name} is required.`;
  if (value.length > max) return `${name} is longer than ${max} characters.`;
  if (value.trim().startsWith("-")) return `${name} cannot start with "-": branchling would read it as a flag.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return `${name} cannot contain control characters.`;
  return null;
}

/**
 * The one shape each action may have, checked identically on the page and on
 * the server: take `{ id }`, release `{ id, reason }`, handoff
 * `{ id, role, reason }`. Every message names the field it is about, as
 * `field`, so the page can mark that input.
 *
 * @returns {{ ok: true, value: object } | { ok: false, field: string|null, message: string }}
 */
export function validateTaskAction(action, input) {
  if (!TASK_ACTIONS.includes(action)) return { ok: false, field: null, message: `"${String(action).slice(0, 40)}" is not an action of the task panel.` };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, field: null, message: "The request must be a JSON object." };
  for (const key of Object.keys(input)) {
    if (key === "actor") return { ok: false, field: null, message: "The actor is not taken from the page: branchling resolves it from the environment of the person who started the server." };
    if (!FIELDS[action].includes(key)) return { ok: false, field: null, message: `Unknown field "${key}".` };
  }
  if (typeof input.id !== "string" || !TASK_ID_SHAPE.test(input.id) || input.id.length > ACTION_LIMITS.id) {
    return { ok: false, field: "id", message: `${JSON.stringify(String(input.id ?? "").slice(0, 40))} is not a task id.` };
  }
  const value = { id: input.id };
  if (action === "handoff") {
    const problem = badWord(input.role, "The role", ACTION_LIMITS.role);
    if (problem) return { ok: false, field: "role", message: problem };
    const role = input.role.trim();
    if (/\s/.test(role)) return { ok: false, field: "role", message: "The role is one word, with no spaces." };
    value.role = role;
  }
  if (action !== "take") {
    if (input.reason === undefined || input.reason === null || (typeof input.reason === "string" && !input.reason.trim())) {
      return { ok: false, field: "reason", message: action === "handoff" ? TASK_ACTIONS_TEXT.handoff.reasonHint : TASK_ACTIONS_TEXT.release.reasonHint };
    }
    const problem = badWord(input.reason, "The reason", ACTION_LIMITS.reason);
    if (problem) return { ok: false, field: "reason", message: problem };
    value.reason = input.reason.trim();
  }
  return { ok: true, value };
}

/** The route each action is POSTed to. */
export function actionPath(action) {
  return `/api/task/${action}`;
}

/**
 * The branchling command a dialog names, as parts for the page to draw (an
 * `arg` part is what the person fills in). Never an `--actor`.
 */
export function actionCommand(action, id, { role } = {}) {
  const parts = [{ text: `branchling ${action} ${id}` }];
  if (action === "handoff") parts.push({ text: " --to-role " }, { text: role && String(role).trim() ? String(role).trim() : "<role>", arg: true });
  if (action !== "take") parts.push({ text: " --reason " }, { text: "\"…\"", arg: true });
  return { parts, text: parts.map(p => p.text).join("") };
}

const str = value => (typeof value === "string" ? value : null);
const shown = value => (value === null || value === undefined || value === "" ? "(empty)" : String(value).replace(/_/g, " "));

function change(field, from, to) {
  return { field, from: from ?? null, to: to ?? null, text: `${field}: ${shown(from)} → ${shown(to)}` };
}

/** The actor of the exchange in a task-panel answer's log that carries `commentId`. */
function actorOfComment(panel, commentId) {
  if (!commentId || !panel || !panel.log || !Array.isArray(panel.log.exchanges)) return null;
  const exchange = panel.log.exchanges.find(x => Array.isArray(x.messages) && x.messages.some(m => m && m.id === commentId));
  return exchange ? str(exchange.actor) : null;
}

/**
 * What branchling answered a successful action with, as a sentence the
 * person can check, the recorded actor in it.
 *
 * @param {"take"|"release"|"handoff"} action
 * @param {object} result the envelope the route answered with, unchanged
 * @param {object|null} [panel] the task-panel answer read after the write
 *   (release's envelope names no actor; its history exchange does)
 */
export function taskActionRecorded(action, result, panel = null) {
  const r = result || {};
  const id = str(r.id) ?? "the task";
  let actor = null;
  let message;
  const changes = [];
  let note = null;
  if (action === "take") {
    actor = str(r.lock && r.lock.actor) ?? str(r.task && r.task.owner);
    if (r.task) changes.push(change("status", r.from, r.task.status));
    message = `${id} is taken${actor ? ` by ${actor}` : ""}.`;
  } else if (action === "release") {
    actor = actorOfComment(panel, str(r.comment));
    // release's envelope gives the new values only, not the old ones.
    for (const key of ["status", "owner"]) changes.push({ field: key, from: null, to: r[key] ?? null, text: `${key}: now ${shown(r[key])}` });
    message = `${id} is back in the queue${actor ? `, released by ${actor}` : ""}.`;
    if (r.released === false) note = "No reservation was held, so none was released; branchling recorded the reason.";
  } else if (action === "handoff") {
    actor = str(r.comment && r.comment.actor);
    // Only what moved: handoff reports every field it touched, changed or not.
    for (const key of ["role", "owner", "status"]) {
      if (r[key] && typeof r[key] === "object" && (r[key].from ?? "") !== (r[key].to ?? "")) changes.push(change(key, r[key].from, r[key].to));
    }
    const role = str(r.role && r.role.to);
    message = `${id} is handed off${role ? ` to ${role}` : ""}${actor ? ` by ${actor}` : ""}.`;
  } else {
    throw new TypeError(`unknown action ${action}`);
  }
  return {
    view: "task",
    state: "recorded",
    action,
    taskId: str(r.id),
    actor,
    actorKnown: actor !== null,
    actorText: actor !== null ? `${TASK_ACTIONS_TEXT.recordedActor} ${actor}. ${TASK_ACTIONS_TEXT.actorNote}` : TASK_ACTIONS_TEXT.actorUnknown,
    message,
    changes,
    note,
  };
}

/**
 * A failed action. A refusal is branchling's text unchanged with its detail
 * lines and kind, and says nothing was written. A role branchling rejected is
 * the `rejected` state, branchling's own message verbatim (it names the
 * declared roles). Anything else is an error from states.mjs.
 */
export function taskActionFailure(action, body, status) {
  const error = (body && body.error) || {};
  if (error.type === "rejected-input") {
    const model = rejectedInputState("task", error, status);
    return {
      ...model,
      action,
      detail: "branchling knows no role by that name in this backlog, so nothing was handed off. Its own message below names the roles it knows.",
      nothingWritten: TASK_ACTIONS_TEXT.nothingWritten,
    };
  }
  const model = fromApiError("task", body, status);
  if (model.state === "refusal") {
    const envelope = error.envelope;
    return {
      ...model,
      action,
      title: TASK_ACTIONS_TEXT.refusalTitle,
      details: envelope && Array.isArray(envelope.details) ? envelope.details.map(String) : [],
      refusalKindText: model.refusalKind ? `${TASK_ACTIONS_TEXT.reasonCode}: ${model.refusalKind}` : null,
      nothingWritten: TASK_ACTIONS_TEXT.nothingWritten,
    };
  }
  return { ...model, action };
}
