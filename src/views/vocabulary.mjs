/**
 * The backlog's vocabulary, for the page's colours and orders (UI-18).
 *
 *   GET /api/vocabulary   `{ vocabulary }`: the adapter's `vocabulary`
 *                         envelope unchanged, or `null` when the installed
 *                         branchling has no such command (0.3.0)
 *
 * Wrapped rather than sent bare, because `null` is a real answer here ("this
 * build cannot say") and a bare JSON `null` body reads like a bug. Every
 * other failure is the adapter's error, mapped by the server as for any
 * view; the page then keeps the neutral palette and the views report the
 * failure themselves on their own reads.
 */

export default {
  id: "vocabulary",
  routes: [
    {
      method: "GET",
      path: "/api/vocabulary",
      handler: async ({ adapter }) => ({ vocabulary: await adapter.vocabulary() }),
    },
  ],
};
