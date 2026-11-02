/**
 * The states every view has besides "ready": loading, empty, error, refusal
 * and stale. Plain data, shared by both surfaces, so the web page and the
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
  const titles = {
    "contract-mismatch": "The installed branchling is not a supported version",
    "usage-error": "The interface called branchling incorrectly",
    "forbidden": "The request was refused by the local server",
    "not-found": "There is nothing at this address",
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

/** The server could not be reached at all (stopped, network error). */
export function unreachableState(view, message) {
  return { view, state: "error", title: "The local server cannot be reached", detail: String(message || ""), errorType: "unreachable", httpStatus: null };
}
