/**
 * The task panel's API (UI-27). The panel opens over any view at
 * `?task=<ID>`; the page builds its model in the browser
 * (src/view-model/task.mjs), as the terminal will.
 *
 *   GET /api/task/panel?id=<ID>  everything the panel shows, ONE composed
 *                                answer of `show`, `log` and two `query` reads
 *                                (readTask in src/adapter.mjs). An unknown id is
 *                                branchling's `no-such-task` refusal (409),
 *                                which the model turns into the not-found state
 *   GET /api/task?id=<ID>        `show <ID> --json` alone, unchanged: the plan
 *                                view's detail read before UI-27 folded its panel
 *                                into this one
 *
 * Read only: nothing here writes, and no actor is passed.
 */

import { readTask } from "../adapter.mjs";
import { RequestError } from "../request-error.mjs";
import { TASK_ID_SHAPE } from "../view-model/tasks.mjs";

/**
 * A task id as branchling numbers them: a prefix, a hyphen, a number. The
 * prefix is the backlog's own (config.yaml), so only the shape is checked.
 * This keeps a missing id from costing a spawn and a value starting with `-`
 * from ever reaching branchling's argument parser as a flag. The same shape
 * the page uses (TASK_ID_SHAPE in src/view-model/tasks.mjs).
 */
export const TASK_ID = TASK_ID_SHAPE;

export function taskIdParam(params) {
  const id = params.get("id");
  if (id === null || id === "") throw new RequestError("The id parameter is required, e.g. /api/task?id=TASK-1");
  if (!TASK_ID.test(id)) throw new RequestError(`${JSON.stringify(id.slice(0, 40))} is not a task id`);
  return id;
}

export default {
  id: "task",
  routes: [
    { method: "GET", path: "/api/task", handler: ({ adapter, params }) => adapter.show(taskIdParam(params)) },
    { method: "GET", path: "/api/task/panel", handler: ({ adapter, params }) => readTask(adapter, taskIdParam(params)) },
  ],
};
