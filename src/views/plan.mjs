/**
 * The plan view's API. Each route answers with one adapter envelope exactly as
 * branchling printed it; the page builds the model in the browser
 * (src/view-model/plan.mjs), the same way the terminal will.
 *
 *   GET /api/plan          `plan --json`: waves, active wave, next up, in
 *                          flight, unplanned, stale
 *   GET /api/plan/tasks    `query --json` (active tasks): the titles and
 *                          `blocked_by` edges the plan envelope does not carry,
 *                          in ONE call rather than a `show` per task
 *
 * The task panel that opens over this view (`&task=<ID>`) is the shared one,
 * src/views/task.mjs (UI-27).
 */

export default {
  id: "plan",
  routes: [
    { method: "GET", path: "/api/plan", handler: ({ adapter }) => adapter.plan() },
    { method: "GET", path: "/api/plan/tasks", handler: ({ adapter }) => adapter.query() },
  ],
};
