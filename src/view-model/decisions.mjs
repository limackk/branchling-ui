/**
 * The decisions view model: plain data computed from branchling's
 * `open-questions` envelope (`branchling log --open-questions --json`, read by
 * listDecisions in src/adapter.mjs): one entry per question still waiting on
 * an answer, across the active tasks.
 *
 * Both surfaces render THIS, never the envelopes (see src/view-model/stats.mjs
 * for the rules: pure, no `node:` import, no DOM, no markup, no ANSI, no
 * colour values, only sibling imports). Time comes in as an argument (`now`),
 * never from a clock read here, so the same input always gives the same model.
 *
 * What the model decides, so no surface has to:
 *   - WHAT IS OPEN is what branchling says is open: an entry of
 *     `log --open-questions`. Nothing is derived from status names.
 *   - one row per open question (a task can carry two), oldest first, with the
 *     task, the question, who asked, when and how long ago.
 *   - the options the asker offered, numbered from 1 as `decide --choose N`
 *     counts them, the recommended one marked in TEXT. The adapter refuses an
 *     entry whose `options` is not a list; a model built from anything else
 *     (an older payload) still says the options are unknown rather than
 *     showing an empty menu as if none were offered.
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
  howToAnswer: "Answer it with branchling, from a shell in the repository that holds this backlog:",
  chooseHint: "with N the number of the option to pick, or",
  reasonPlaceholder: "YOUR ANSWER",
  // One terminal line: --require-actor in the commands is why it refuses
  // rather than recording branchling's default agent.
  actorNote: "branchling takes the actor from $BACKLOG_ACTOR or your user config, or refuses.",
};

/** Where branchling took the recorded actor from (`decide --json` `actorSource`, TL-537). */
export const ACTOR_SOURCE_TEXT = {
  flag: "named with --actor",
  env: "taken from $BACKLOG_ACTOR",
  config: "taken from your branchling user config",
};

/** A word as a POSIX shell reads it: bare when it is safe, else single-quoted. */
export function shellWord(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text) && !text.startsWith("-")) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

/**
 * The exact `branchling decide` commands that answer one open question, for a
 * surface that cannot record the answer itself (the terminal interface). The
 * same two shapes `validateDecision` accepts; never an `--actor`: branchling
 * resolves who answered from the environment of the person who runs it, and
 * `--require-actor` makes it refuse rather than fall back to its default
 * agent, as the page's answers do. `choose` is null when no options are known.
 */
export function answerCommands(taskId, questionId, { optionsKnown = false, options = [] } = {}) {
  const base = `branchling decide ${shellWord(taskId)} --resolves ${shellWord(questionId)}`;
  return {
    choose: optionsKnown && options.length ? `${base} --choose N --require-actor` : null,
    reason: `${base} --reason "${DECISIONS_TEXT.reasonPlaceholder}" --require-actor`,
  };
}

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

function questionOf(entry, now) {
  const taskId = String(entry.task);
  const questionId = String(entry.event);
  const { known, options } = optionsOf(entry);
  const askedAt = str(entry.askedAt);
  const age = ageOf(askedAt, now);
  const status = str(entry.status);
  return {
    key: `${taskId}:${questionId}`,
    taskId,
    title: str(entry.title) ?? "",
    status,
    statusLabel: status === null ? "status unknown" : status.replace(/_/g, " "),
    role: statusRole(status),
    questionId,
    text: str(entry.question) ?? "",
    askedBy: str(entry.askedBy) || "unknown",
    askedAt,
    ageMs: age.ms,
    ageLabel: age.label ?? "asked at an unknown time",
    optionsKnown: known,
    options,
    optionsNote: !known ? DECISIONS_TEXT.optionsUnknown : options.length ? null : DECISIONS_TEXT.noOptions,
    needs: DECISIONS_TEXT.needs,
    commands: answerCommands(taskId, questionId, { optionsKnown: known, options }),
  };
}

/**
 * @param {object} answer the `open-questions` envelope listDecisions returns
 * @param {{ stale?: boolean, fetchedAt?: string|null }} [freshness]
 * @param {number|string} [now] the current time (epoch ms or ISO), for ages
 */
export function decisionsModel(answer, freshness = {}, now) {
  if (!answer || answer.kind !== "open-questions" || !Array.isArray(answer.questions)) {
    throw new TypeError("decisionsModel needs branchling's open-questions answer");
  }
  const questions = answer.questions.map(q => questionOf(q, now));
  // branchling already lists them oldest first; sorting again keeps the order
  // a property of this model rather than of whatever produced its input.
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
  const actorSource = str(result && result.actorSource);
  return {
    view: "decisions",
    state: "recorded",
    taskId: str(result && result.id),
    decisionId: str(decision.id),
    text: str(decision.text) ?? "",
    actor: str(decision.actor) ?? "unknown",
    actorSource,
    actorSourceLabel: actorSource && ACTOR_SOURCE_TEXT[actorSource] ? `The actor was ${ACTOR_SOURCE_TEXT[actorSource]}.` : null,
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
  // An answer MAY start with "-" ("-1 for this"): the adapter passes it as
  // one `--reason=<text>` word, which branchling never reads as a flag.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)) return { ok: false, message: "The answer cannot contain control characters." };
  return { ok: true, value: { id: input.id, resolves: input.resolves, reason } };
}
