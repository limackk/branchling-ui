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
 *   GET /api/task?id=<ID>  `show <ID> --json`, for the detail panel
 */

import { RequestError } from "../request-error.mjs";

/**
 * A task id as branchling numbers them: a prefix, a hyphen, a number. The
 * prefix is the backlog's own (config.yaml), so only the shape is checked.
 * This keeps a missing id from costing a spawn and a value starting with `-`
 * from ever reaching branchling's argument parser as a flag.
 */
export const TASK_ID = /^[A-Za-z][A-Za-z0-9_]{0,31}-[0-9]{1,9}$/;

export function taskIdParam(params) {
  const id = params.get("id");
  if (id === null || id === "") throw new RequestError("The id parameter is required, e.g. /api/task?id=TASK-1");
  if (!TASK_ID.test(id)) throw new RequestError(`${JSON.stringify(id.slice(0, 40))} is not a task id`);
  return id;
}

export default {
  id: "plan",
  routes: [
    { method: "GET", path: "/api/plan", handler: ({ adapter }) => adapter.plan() },
    { method: "GET", path: "/api/plan/tasks", handler: ({ adapter }) => adapter.query() },
    { method: "GET", path: "/api/task", handler: ({ adapter, params }) => adapter.show(taskIdParam(params)) },
  ],
};
