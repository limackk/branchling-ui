/**
 * The health view's API (UI-28). Each route answers with one adapter envelope
 * exactly as branchling printed it; the page builds the model in the browser
 * (src/view-model/health.mjs), the same way the terminal will.
 *
 *   GET /api/health/doctor     `doctor --json`: the setup checks
 *   GET /api/health/check      `check --json`: the release gate (bare check)
 *   GET /api/health/divergent  `stats --json`, for its `divergent` list
 *
 * Three routes, not one composed answer, so each section of the page renders
 * as soon as its own read answers: `doctor` takes about 1.4 s on a small
 * backlog, `check` about 0.4 s and `stats` (cached) about 0.1 s.
 *
 * A failing doctor or check is a 200 with `ok: false`: the adapter returns
 * the verdict instead of throwing (VERDICT_KINDS in src/adapter.mjs). A
 * refusal, a usage error or a contract mismatch is thrown and mapped by the
 * server as for every route. Read only: no route here writes, and no actor is
 * ever passed.
 */

export default {
  id: "health",
  routes: [
    { method: "GET", path: "/api/health/doctor", handler: ({ adapter }) => adapter.doctor() },
    { method: "GET", path: "/api/health/check", handler: ({ adapter }) => adapter.check() },
    { method: "GET", path: "/api/health/divergent", handler: ({ adapter }) => adapter.stats() },
  ],
};
