/**
 * A request the server answers with a 4xx of its own. Two cases:
 *
 *   - a missing or malformed parameter: a handler throws it BEFORE calling
 *     the adapter, so a bad request costs no spawn;
 *   - a name the user typed that branchling rejected (`rejectingTypedInput`):
 *     `422 rejected-input`, with the names and what is declared.
 *
 * The server answers with its status (4xx only) and
 * `{ error: { type, message, ...fields } }`, like every other failure.
 *
 * Its own module so a view can import it without importing the server, which
 * imports the views.
 */

import { BranchlingUsageError } from "./adapter.mjs";

export class RequestError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, type?: string, fields?: object }} [options]
   *   `fields` are extra plain-data keys of the JSON error body.
   */
  constructor(message, { status = 400, type = "bad-request", fields = {} } = {}) {
    super(message);
    if (!Number.isInteger(status) || status < 400 || status > 499) throw new RangeError(`RequestError status must be 4xx, got ${status}`);
    this.name = "RequestError";
    this.status = status;
    this.type = type;
    this.fields = fields;
  }
}

/**
 * Runs `call` and, when branchling answers it with a usage error while
 * `input` holds a name the user typed, rethrows that as
 * `422 rejected-input` instead of the interface-bug `500 usage-error`.
 *
 * INTERIM (UI-21): branchling 0.2.0 rejects an undeclared vocabulary value
 * (a release, a target, a stage) with stderr only and exit 2, no envelope,
 * so nothing in the answer says WHICH value or why. The judgement here is
 * "a usage error on a call that carried typed names is the names' fault".
 * Once branchling answers with a refusal envelope for it (a `refusalKind`
 * such as `unknown-name`), the adapter throws BranchlingRefusal and this
 * helper is no longer reached; delete it then.
 *
 * branchling's message goes along verbatim as `detail`, for a person to read.
 * Nothing branches on its wording.
 *
 * @param {Record<string, string>} input the user-typed names, by parameter
 * @param {() => Promise<any>} call the adapter call that carries them
 * @param {(keys: string[]) => Promise<Record<string, string[]|null>>} [declared]
 *   the declared names per parameter, from branchling's own JSON; `null` for a
 *   parameter whose names branchling does not give as data. Asked only on a
 *   rejection, and a failure of it leaves every list unknown.
 */
export async function rejectingTypedInput(input, call, declared) {
  try {
    return await call();
  } catch (err) {
    const keys = Object.keys(input).filter(k => typeof input[k] === "string" && input[k] !== "");
    if (!(err instanceof BranchlingUsageError) || !keys.length) throw err;
    const typed = Object.fromEntries(keys.map(k => [k, input[k]]));
    let lists = {};
    if (declared) {
      try { lists = (await declared(keys)) || {}; } catch { lists = {}; }
    }
    const known = Object.fromEntries(keys.map(k => [k, Array.isArray(lists[k]) ? lists[k].map(String) : null]));
    throw new RequestError(`branchling rejected a name that was typed: ${keys.map(k => `${k}=${typed[k]}`).join(", ")}`, {
      status: 422,
      type: "rejected-input",
      fields: { input: typed, declared: known, detail: String(err.stderr || "").trim() },
    });
  }
}
