/**
 * The decisions view model: plain data computed from the adapter's composed
 * `decisions` answer (src/adapter.mjs, `decisions()`): every active task's row
 * from `branchling query --json` with its `branchling log <ID> --decisions
 * --json` envelope, for the tasks that carry an open question.
 *
 * Both surfaces render THIS, never the envelopes (see src/view-model/stats.mjs
 * for the rules: pure, no `node:` import, no DOM, no markup, no ANSI, no
 * colour values, only sibling imports). Time comes in as an argument (`now`),
 * never from a clock read here, so the same input always gives the same model.
 *
 * What the model decides, so no surface has to:
 *   - WHAT IS OPEN is what branchling says is open: a `question` message that
 *     `log --decisions` still reports. Nothing is derived from status names.
 *   - one row per open question (a task can carry two), oldest first, with the
 *     task, the question, who asked, when and how long ago.
 *   - the options, when the answer carries them, numbered from 1 as
 *     `decide --choose <n>` counts them, the recommended one marked in TEXT.
 *     branchling 0.2's `log --decisions --json` does not report a question's
 *     options (an upstream gap), so they are read only if present, under the
 *     names `ask --json` uses (`options`, `recommend`); until then a question
 *     offers the free-text answer only, and says so.
 *   - the shape of an answer (`validateDecision`), shared by the page and the
 *     server's route, so both refuse the same input with the same sentence.
 */

import { fromApiError, loadingState } from "./states.mjs";
import { statusRole } from "./roles.mjs";

export const DECISIONS_TEXT = {
  title: "Decisions waiting on a person",
  loading: "Loading the questions waiting on a decision…",
  empty: "Nothing is waiting on a decision.",
  stale: "Showing the last known questions; a fresh read is on its way.",
  needs: "Needs a person to answer this question.",
  optionsLegend: "Choose an answer",
  ownWords: "Answer in my own words",
  reasonLabel: "Your answer",
  noOptions: "No options were offered with this question; answer in your own words.",
  optionsUnknown: "The options offered with this question cannot be shown yet; answer in your own words.",
  recommended: "recommended",
  submit: "Record the answer",
  submitting: "Recording the answer…",
};

/** Limits on an answer, checked before branchling is called. */
export const LIMITS = { id: 64, resolves: 64, reason: 2000, choose: 1000 };

function str(value) {
  return typeof value === "string" ? value : null;
}

function nowMs(now) {
  if (typeof now === "number" && Number.isFinite(now)) return now;
  if (typeof now === "string") {
    const t = Date.parse(now);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * How long ago `ts` was, as of `now` (epoch ms or an ISO string).
 * `{ ms: null, label: null }` when either is unknown, never a guess.
 */
export function ageOf(ts, now) {
  const at = typeof ts === "string" ? Date.parse(ts) : NaN;
  const ref = nowMs(now);
  if (!Number.isFinite(at) || ref === null) return { ms: null, label: null };
  const ms = Math.max(0, ref - at);
  const minutes = Math.floor(ms / 60000);
  let span;
  if (minutes < 1) span = "less than a minute";
  else if (minutes < 60) span = `${minutes} min`;
  else if (minutes < 60 * 24) span = `${Math.floor(minutes / 60)} h`;
  else span = `${Math.floor(minutes / (60 * 24))} d`;
  return { ms, label: `asked ${span} ago` };
}

function optionsOf(message) {
  if (!Array.isArray(message.options)) return { known: false, options: [] };
  const recommend = Number.isInteger(message.recommend) ? message.recommend : null;
  return {
    known: true,
    options: message.options.map((text, i) => ({
      number: i + 1,
      text: String(text),
      recommended: recommend === i + 1,
      label: recommend === i + 1 ? `${String(text)} (${DECISIONS_TEXT.recommended})` : String(text),
    })),
  };
}

function questionsOf(entry, now) {
  const task = entry.task || {};
  const exchanges = Array.isArray(entry.log && entry.log.exchanges) ? entry.log.exchanges : [];
  const out = [];
  for (const x of exchanges) {
    for (const m of Array.isArray(x.messages) ? x.messages : []) {
      if (!m || m.kind !== "question") continue;
      // `text: null` means "the exchange's reason, verbatim" (branchling log).
      const text = str(m.text) ?? str(x.reason) ?? "";
      const { known, options } = optionsOf(m);
      const age = ageOf(x.ts, now);
      const status = str(task.status);
      out.push({
        key: `${String(task.id)}:${String(m.id)}`,
        taskId: String(task.id),
        title: str(task.title) ?? "",
        status,
        statusLabel: status === null ? "status unknown" : status.replace(/_/g, " "),
        role: statusRole(status),
        priority: str(task.priority),
        questionId: String(m.id),
        text,
        askedBy: str(x.actor) || "unknown",
        askedAt: str(x.ts),
        ageMs: age.ms,
        ageLabel: age.label ?? "asked at an unknown time",
        optionsKnown: known,
        options,
        optionsNote: !known ? DECISIONS_TEXT.optionsUnknown : options.length ? null : DECISIONS_TEXT.noOptions,
        needs: DECISIONS_TEXT.needs,
      });
    }
  }
  return out;
}

/**
 * @param {object} answer the adapter's `decisions` answer
 * @param {{ stale?: boolean, fetchedAt?: string|null }} [freshness]
 * @param {number|string} [now] the current time (epoch ms or ISO), for ages
 */
export function decisionsModel(answer, freshness = {}, now) {
  if (!answer || answer.kind !== "decisions" || !Array.isArray(answer.tasks)) {
    throw new TypeError("decisionsModel needs the adapter's decisions answer");
  }
  const questions = answer.tasks.flatMap(entry => questionsOf(entry, now));
  questions.sort((a, b) => {
    const ta = a.askedAt ? Date.parse(a.askedAt) : Infinity;
    const tb = b.askedAt ? Date.parse(b.askedAt) : Infinity;
    if (ta !== tb) return ta - tb;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  const taskCount = new Set(questions.map(q => q.taskId)).size;
  return {
    view: "decisions",
    state: questions.length ? "ready" : "empty",
    freshness: { stale: freshness.stale === true, fetchedAt: freshness.fetchedAt ?? null },
    scanned: typeof answer.scanned === "number" ? answer.scanned : null,
    count: questions.length,
    taskCount,
    summary: questions.length
      ? `${questions.length} open question${questions.length === 1 ? "" : "s"} on ${taskCount} task${taskCount === 1 ? "" : "s"}`
      : DECISIONS_TEXT.empty,
    emptyText: questions.length ? null : DECISIONS_TEXT.empty,
    questions,
  };
}

export function decisionsLoading() {
  return loadingState("decisions");
}

/**
 * The failure of a read or of an answer, from the server's JSON error body.
 * A refusal keeps branchling's text unchanged and adds its detail lines.
 */
export function decisionsFailure(body, status) {
  const model = fromApiError("decisions", body, status);
  const envelope = body && body.error && body.error.envelope;
  model.details = model.state === "refusal" && envelope && Array.isArray(envelope.details)
    ? envelope.details.map(String)
    : [];
  return model;
}

/** What `decide --json` answered, as a sentence the person can check. */
export function decisionRecorded(result) {
  const decision = (result && result.decision) || {};
  const lifted = result && result.lifted;
  const remaining = Array.isArray(result && result.openQuestions) ? result.openQuestions.length : 0;
  return {
    view: "decisions",
    state: "recorded",
    taskId: str(result && result.id),
    decisionId: str(decision.id),
    text: str(decision.text) ?? "",
    actor: str(decision.actor) ?? "unknown",
    message: `Recorded for ${str(result && result.id) ?? "the task"} as ${str(decision.actor) ?? "an unknown actor"}: ${str(decision.text) ?? ""}`,
    liftedLabel: lifted && lifted.from && lifted.to ? `Its status moved from ${String(lifted.from).replace(/_/g, " ")} to ${String(lifted.to).replace(/_/g, " ")}.` : null,
    remaining,
    remainingLabel: remaining ? `${remaining} more open question${remaining === 1 ? "" : "s"} on this task.` : null,
  };
}

function badWord(value, name, max) {
  if (typeof value !== "string" || !value.trim()) return `${name} is required.`;
  if (value.length > max) return `${name} is longer than ${max} characters.`;
  if (value.startsWith("-")) return `${name} cannot start with "-": branchling would read it as a flag.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return `${name} cannot contain control characters.`;
  return null;
}

/**
 * The one shape an answer may have, checked identically on the page and on
 * the server: `{ id, resolves, choose }` or `{ id, resolves, reason }`.
 * Nothing else is accepted, an `actor` least of all: the page cannot vouch for
 * who is sitting in front of it, so branchling resolves the actor itself.
 *
 * @returns {{ ok: true, value: { id: string, resolves: string, choose?: number, reason?: string } } | { ok: false, message: string }}
 */
export function validateDecision(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, message: "The answer must be a JSON object." };
  for (const key of Object.keys(input)) {
    if (key === "actor") return { ok: false, message: "The actor is not taken from the page: branchling resolves it from the environment of the person who started the server." };
    if (!["id", "resolves", "choose", "reason"].includes(key)) return { ok: false, message: `Unknown field "${key}".` };
  }
  const idProblem = badWord(input.id, "The task id", LIMITS.id);
  if (idProblem) return { ok: false, message: idProblem };
  const resolvesProblem = badWord(input.resolves, "The question id", LIMITS.resolves);
  if (resolvesProblem) return { ok: false, message: resolvesProblem };
  const hasChoose = input.choose !== undefined && input.choose !== null;
  const hasReason = input.reason !== undefined && input.reason !== null;
  if (hasChoose === hasReason) return { ok: false, message: "Choose one option or write an answer, not both and not neither." };
  if (hasChoose) {
    if (!Number.isInteger(input.choose) || input.choose < 1 || input.choose > LIMITS.choose) return { ok: false, message: "The chosen option must be a whole number from 1." };
    return { ok: true, value: { id: input.id, resolves: input.resolves, choose: input.choose } };
  }
  if (typeof input.reason !== "string") return { ok: false, message: "The answer must be text." };
  const reason = input.reason.trim();
  if (!reason) return { ok: false, message: "The answer is empty." };
  if (reason.length > LIMITS.reason) return { ok: false, message: `The answer is longer than ${LIMITS.reason} characters.` };
  if (reason.startsWith("-")) return { ok: false, message: "The answer cannot start with \"-\": branchling would read it as a flag." };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)) return { ok: false, message: "The answer cannot contain control characters." };
  return { ok: true, value: { id: input.id, resolves: input.resolves, reason } };
}
