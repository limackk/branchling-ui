/**
 * A request the server answers with a 4xx of its own. Two cases:
 *
 *   - a missing or malformed parameter: a handler throws it BEFORE calling
 *     the adapter, so a bad request costs no spawn;
 *   - a name the user typed that branchling rejected with a usage error
 *     rather than a refusal envelope (`rejectingTypedInput`):
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
 * INTERIM (UI-21): branchling rejects a value outside a closed vocabulary
 * with stderr only and exit 2, no envelope, so nothing in the answer says
 * WHICH value or why. The judgement here is "a usage error on a call that
 * carried typed names is the names' fault".
 *
 * `deploy status` no longer needs it: since TL-533 an undeclared release,
 * target or stage is a refusal envelope (`unknown-name`), so the release
 * route lets the adapter's BranchlingRefusal through and the rejected state
 * is built from the envelope (UI-24). It stays only for `query` (status,
 * priority, board) and `handoff --role`, which still answer exit 2 with
 * stderr only on the unreleased branchling main; delete it once both answer
 * a refusal envelope.
 *
 * branchling's message goes along verbatim as `detail`, for a person to read.
 * Nothing branches on its wording.
 *
 * @param {Record<string, string>} input the user-typed names, by parameter
 * @param {() => Promise<any>} call the adapter call that carries them
 * @param {(keys: string[]) => Promise<Record<string, string[]|null>>} [declared]
 *   the declared names per parameter, from branchling's own JSON
 *   (declaredFromAdapter: the `vocabulary` envelope); `null` for a parameter
 *   whose names branchling does not give as data. Asked only on a
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

/**
 * Where each typed parameter's declared names live in the `vocabulary`
 * envelope (UI-18, upstream TL-532), as a function from the envelope to a
 * list of names, or `undefined` when the envelope carries no such array.
 * `board` is the slug, because the slug is what `query --board` matches.
 */
const VOCABULARY_LISTS = {
  status: v => Array.isArray(v.statuses) ? v.statuses.map(s => s && s.name) : undefined,
  priority: v => v.priorities,
  board: v => Array.isArray(v.boards) ? v.boards.map(b => b && b.slug) : undefined,
  role: v => v.roles,
  release: v => Array.isArray(v.releases) ? v.releases.map(r => r && r.name) : undefined,
  target: v => Array.isArray(v.deploy_targets) ? v.deploy_targets.map(t => (t && typeof t === "object" ? t.name : t)) : undefined,
};

/**
 * The declared names per parameter from a `vocabulary` envelope (UI-44):
 * `null` for every key when the envelope is `null` (the executable has no
 * `vocabulary` command, adapter.vocabulary()) and for a key the envelope
 * does not list. Never an invented empty list: "not known" stays `null`.
 *
 * @param {object|null} vocabulary
 * @param {string[]} keys
 * @returns {Record<string, string[]|null>}
 */
export function declaredFromVocabulary(vocabulary, keys) {
  return Object.fromEntries(keys.map(key => {
    const pick = VOCABULARY_LISTS[key];
    const list = vocabulary && typeof vocabulary === "object" && pick ? pick(vocabulary) : undefined;
    const names = Array.isArray(list) && list.every(n => typeof n === "string" && n) ? list.slice() : null;
    return [key, names];
  }));
}

/**
 * The `declared` argument of rejectingTypedInput for a view: the adapter's
 * `vocabulary` (cached like every read), asked only on a rejection. An
 * adapter without the call answers `null` lists, like an executable without
 * the command.
 *
 * @param {{ vocabulary?: () => Promise<object|null> }} adapter
 * @returns {(keys: string[]) => Promise<Record<string, string[]|null>>}
 */
export function declaredFromAdapter(adapter) {
  return async keys => declaredFromVocabulary(
    adapter && typeof adapter.vocabulary === "function" ? await adapter.vocabulary() : null,
    keys,
  );
}

