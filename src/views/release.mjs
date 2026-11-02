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
 */

import { rejectingTypedInput } from "../request-error.mjs";

/**
 * The declared names, from branchling's own JSON. The unfiltered envelope
 * names every deploy target; no command of branchling 0.2.0 gives the
 * declared releases as data, so that list is `null` (unknown), not empty.
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
  ],
};
