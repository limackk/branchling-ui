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
 * The panel's writes (UI-30), each one branchling command:
 *
 *   POST /api/task/take      `{ id }`                  `take <ID>`
 *   POST /api/task/release   `{ id, reason }`          `release <ID> --reason`
 *   POST /api/task/handoff   `{ id, role, reason }`    `handoff <ID> --to-role --reason`
 *
 * Each sits behind the server's write guard (Host, Origin and the capability
 * token), which runs before any handler and before the body is read; nothing
 * here repeats it. The body is checked by the same `validateTaskAction` the
 * page uses, and a malformed one (an `actor`, `take-over` or any other field
 * included) is a 400 before branchling runs. No actor is passed: branchling
 * resolves it from the environment of the person who started the server.
 * The answer is the envelope branchling printed, unchanged; a refusal is the
 * server's 409 with its text unchanged. A role branchling does not know
 * (exit 2, stderr only, in 0.2.0) is `422 rejected-input` for that role, with
 * branchling's message verbatim and the declared roles from the
 * `vocabulary` envelope (UI-44), `null` when the executable has none. The
 * cache passes every write through and invalidates what it holds, so the
 * panel's next read is fresh.
 *
 * The panel's field edits (UI-6), one branchling command each:
 *
 *   POST /api/task/field     `{ id, field, value, reason? }`
 *                            `set <ID> <field> <value> [--reason]`
 *
 * Behind the same guard, checked by `validateFieldEdit`
 * (src/view-model/task-fields.mjs, shared with the page): an `actor` or any
 * other key is a 400 before branchling runs. Which fields `set` edits and
 * which values it accepts is branchling's answer: status, owner, an unknown
 * field or a value outside the vocabulary come back as its refusal (409),
 * text unchanged. The cache passes `set` through as a write.
 */

import { readTask } from "../adapter.mjs";
import { RequestError, declaredFromAdapter, rejectingTypedInput } from "../request-error.mjs";
import { validateTaskAction } from "../view-model/task-actions.mjs";
import { FIELD_EDIT_PATH, validateFieldEdit } from "../view-model/task-fields.mjs";
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

/** The body of an action, checked before branchling runs; a 400 otherwise. */
function checked(action, body) {
  const result = validateTaskAction(action, body);
  if (!result.ok) throw new RequestError(result.message);
  return result.value;
}

export default {
  id: "task",
  routes: [
    { method: "GET", path: "/api/task", handler: ({ adapter, params }) => adapter.show(taskIdParam(params)) },
    { method: "GET", path: "/api/task/panel", handler: ({ adapter, params }) => readTask(adapter, taskIdParam(params)) },
    { method: "POST", path: "/api/task/take", handler: ({ adapter, body }) => adapter.take(checked("take", body).id) },
    {
      method: "POST",
      path: "/api/task/release",
      handler: ({ adapter, body }) => {
        const { id, reason } = checked("release", body);
        return adapter.release(id, { reason });
      },
    },
    {
      method: "POST",
      path: "/api/task/handoff",
      handler: ({ adapter, body }) => {
        const { id, role, reason } = checked("handoff", body);
        return rejectingTypedInput({ role }, () => adapter.handoff(id, { role, reason }), declaredFromAdapter(adapter));
      },
    },
    {
      method: "POST",
      path: FIELD_EDIT_PATH,
      handler: ({ adapter, body }) => {
        const result = validateFieldEdit(body);
        if (!result.ok) throw new RequestError(result.message);
        const { id, field, value, reason } = result.value;
        return adapter.set(id, field, value, { reason });
      },
    },
  ],
};
