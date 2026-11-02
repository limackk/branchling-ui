/**
 * The stats view's API. It answers with the adapter's stats envelope exactly
 * as branchling printed it; the page turns that into the view model in the
 * browser (src/view-model/stats.mjs), the same way the terminal will.
 */

export default {
  id: "stats",
  routes: [
    {
      method: "GET",
      path: "/api/stats",
      handler: ({ adapter }) => adapter.stats(),
    },
  ],
};
