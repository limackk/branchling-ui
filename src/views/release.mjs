/**
 * The release view's API. It answers with the adapter's `release-status`
 * envelope exactly as branchling printed it; the page turns that into the view
 * model in the browser (src/view-model/release.mjs), as the terminal will.
 *
 *   GET /api/release[?target=<name>][&release=<name>]
 *
 * `target` and `release` pass through to `deploy status --target/--release`.
 * They are names the user typed, so an undeclared one is `422 rejected-input`
 * (src/request-error.mjs, UI-21) with the names and what is declared: never an
 * empty pipeline, and never the interface-bug `500 usage-error`, which stays
 * for a call this package built wrongly.
 *
 * Release planning (UI-8) adds one write:
 *
 *   POST /api/release/declare  `{ name, reason, ref? }`
 *                              `declare releases <name> --reason "…" [--ref]`
 *
 * behind the server's write guard, checked by `validateDeclare`
 * (src/view-model/release-planning.mjs, shared with the page): an `actor` or
 * any other key, and a missing reason, are a 400 before branchling runs. No
 * actor is passed. Every failure of `declare` is a refusal envelope
 * (`duplicate`, `malformed`, `usage`), so the server's 409 with branchling's
 * text unchanged. The cache passes it through as a write, so the next
 * `/api/release?release=<name>` spawns and sees the new config.yaml.
 * Planning a task for a release is UI-6's POST /api/task/field
 * (`set <ID> release <name>`); there is no second route for it.
 */

import { RequestError, rejectingTypedInput } from "../request-error.mjs";
import { DECLARE_PATH, validateDeclare } from "../view-model/release-planning.mjs";

/**
 * The declared names, from branchling's own JSON. The unfiltered envelope
 * names every deploy target; no command of branchling 0.3.0 gives the
 * declared releases as data (measured for UI-8: not deploy status, stats,
 * query, doctor, plan, show, log, audit or where), so that list is `null`
 * (unknown), not empty.
 */
async function declaredNames(adapter, keys) {
  const out = { release: null, target: null };
  if (keys.includes("target")) {
    const envelope = await adapter.deployStatus();
    out.target = envelope.targets.map(t => String(t.target));
  }
  return out;
}

export default {
  id: "release",
  routes: [
    {
      method: "GET",
      path: "/api/release",
      handler: ({ adapter, params }) => {
        const options = {};
        for (const key of ["target", "release"]) {
          const value = params.get(key);
          if (value) options[key] = value;
        }
        return rejectingTypedInput(options, () => adapter.deployStatus(options), keys => declaredNames(adapter, keys));
      },
    },
    {
      method: "POST",
      path: DECLARE_PATH,
      handler: ({ adapter, body }) => {
        const checked = validateDeclare(body);
        if (!checked.ok) throw new RequestError(checked.message);
        const { name, reason, ref } = checked.value;
        return adapter.declare("releases", name, { reason, ref });
      },
    },
  ],
};
