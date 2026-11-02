/**
 * The release view's API. It answers with the adapter's `release-status`
 * envelope exactly as branchling printed it; the page turns that into the view
 * model in the browser (src/view-model/release.mjs), as the terminal will.
 *
 *   GET /api/release[?target=<name>][&release=<name>]
 *
 * `target` and `release` pass through to `deploy status --target/--release`.
 * An undeclared name is branchling's usage error, which the server maps to a
 * JSON error: never an empty pipeline.
 */

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
        return adapter.deployStatus(options);
      },
    },
  ],
};
