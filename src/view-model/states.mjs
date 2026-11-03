/**
 * The states every view has besides "ready": loading, empty, error, refusal,
 * rejected (a name the user typed that branchling rejected, UI-21) and
 * stale. Plain data, shared by both surfaces, so the web page and the
 * terminal interface say the same thing in the same situation.
 *
 * `fromApiError` takes the JSON error body the server sends (see
 * src/server.mjs, `errorBody`) and never turns a failure into an empty result:
 * an empty list after a refusal looks exactly like an empty backlog.
 */

export function loadingState(view) {
  return { view, state: "loading" };
}

/**
 * @param {string} view
 * @param {{ error?: { type?: string, message?: string, refusalKind?: string|null } }} body
 * @param {number} [status] the HTTP status, when there was a response at all
 */
export function fromApiError(view, body, status) {
  const error = (body && body.error) || {};
  const message = typeof error.message === "string" && error.message ? error.message : "No detail was given.";
  if (error.type === "refusal") {
    // An answer the user may have to act on, not a fault.
    return { view, state: "refusal", title: "branchling declined the request", detail: message, refusalKind: error.refusalKind ?? null };
  }
  if (error.type === "rejected-input") {
    // A name the user typed, not a fault of this package (UI-21).
    return rejectedInputState(view, error, status);
  }
  const titles = {
    "contract-mismatch": "The installed branchling is not a supported version",
    "usage-error": "The interface called branchling incorrectly",
    "forbidden": "The request was refused by the local server",
    "not-found": "There is nothing at this address",
    "bad-request": "The request was not understood",
    "payload-too-large": "The request was too large",
    "unsupported-media-type": "The request was not sent as JSON",
  };
  return {
    view,
    state: "error",
    title: titles[error.type] || "Something went wrong",
    detail: message,
    errorType: error.type || "unknown",
    httpStatus: typeof status === "number" ? status : null,
  };
}

/** What a parameter's names are called, singular and plural. */
const NOUNS = {
  release: ["release", "releases"],
  target: ["deploy target", "deploy targets"],
  stage: ["stage", "stages"],
  role: ["role", "roles"],
};

function nouns(key) {
  return NOUNS[key] || [`${key}`, `${key} values`];
}

/**
 * A name the user typed (a release, a target, a stage) that branchling
 * rejected: its own state, `rejected`, not the interface-bug error. The
 * server's `422 rejected-input` body carries the typed names (`input`), the
 * declared names per parameter as branchling gave them as data (`declared`,
 * `null` for "not known"), and branchling's own message (`detail`), which is
 * shown verbatim and never read for meaning.
 *
 * When several names were typed, one that IS in its declared list is not the
 * culprit; the others are. A list that is not known is said so, never shown
 * as empty.
 *
 * @param {string} view
 * @param {{ input?: Record<string,string>, declared?: Record<string,string[]|null>, detail?: string }} error
 * @param {number} [status]
 */
export function rejectedInputState(view, error = {}, status) {
  const input = error && typeof error.input === "object" && error.input ? error.input : {};
  const declared = error && typeof error.declared === "object" && error.declared ? error.declared : {};
  const names = Object.entries(input).map(([key, value]) => {
    const [noun, plural] = nouns(key);
    const list = Array.isArray(declared[key]) ? declared[key].map(String) : null;
    let declaredText;
    if (list === null) declaredText = `This page has no list of the declared ${plural}: branchling does not give it as data yet. Its own message below names them.`;
    else if (!list.length) declaredText = `This backlog declares no ${plural}.`;
    else declaredText = `The declared ${plural}: ${list.join(", ")}.`;
    return {
      key,
      noun,
      value: String(value),
      declared: list,
      known: list !== null,
      isDeclared: list === null ? null : list.includes(String(value)),
      declaredText,
    };
  });
  const suspects = names.filter(n => n.isDeclared !== true);
  const rejected = suspects.length ? suspects : names;
  const one = rejected.length === 1 ? rejected[0] : null;
  const detailText = typeof error.detail === "string" && error.detail.trim() ? error.detail.trim() : null;
  return {
    view,
    state: "rejected",
    title: one ? `No ${one.noun} named \u201c${one.value}\u201d is declared` : "A name that was typed is not declared",
    detail: one
      ? `branchling knows no ${one.noun} by that name in this backlog, so there is nothing to show for it. Pick a declared one, or clear the name.`
      : `branchling rejected one of these: ${rejected.map(n => `${n.noun} \u201c${n.value}\u201d`).join(", ")}. Pick declared names, or clear them.`,
    names: rejected,
    branchlingSaid: detailText,
    branchlingSaidLabel: "branchling said",
    errorType: "rejected-input",
    httpStatus: typeof status === "number" ? status : null,
  };
}

/** The server could not be reached at all (stopped, network error). */
export function unreachableState(view, message) {
  return { view, state: "error", title: "The local server cannot be reached", detail: String(message || ""), errorType: "unreachable", httpStatus: null };
}

/**
 * An error thrown by the adapter itself, for a surface that calls it directly
 * (the terminal interface) instead of through the server's API. It is judged
 * by `err.name`, not `instanceof`, so this module still imports nothing; the
 * mapping is the server's `errorBody` one, so both surfaces show the same
 * title for the same failure.
 *
 * @param {string} view
 * @param {{ name?: string, message?: string, envelope?: { refusalKind?: string|null } }} err
 */
export function fromAdapterError(view, err) {
  const types = {
    BranchlingRefusal: "refusal",
    ContractMismatch: "contract-mismatch",
    BranchlingUsageError: "usage-error",
  };
  const type = (err && types[err.name]) || "internal";
  const message = String((err && err.message) || err || "");
  const error = { type, message };
  if (type === "refusal") error.refusalKind = (err.envelope && err.envelope.refusalKind) ?? null;
  return fromApiError(view, { error });
}
