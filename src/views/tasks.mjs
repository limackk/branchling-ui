/**
 * The tasks view's API (UI-26). It answers with the adapter's `task-list`
 * envelope exactly as branchling printed it; the page builds the model in the
 * browser (src/view-model/tasks.mjs), as the terminal will.
 *
 *   GET /api/tasks[?text=][&status=][&priority=][&board=][&epic=][&owner=][&label=][&scope=]
 *
 * Each known parameter passes through to the `query` flag of the same name;
 * any other parameter is ignored. Without `status` or `scope`, branchling
 * lists the ACTIVE tasks only; `scope=archived|all` is `query --scope`
 * (TL-540, UI-33). A value is checked by the same validateTaskFilters the
 * page uses before anything is spawned: one that is too long, has a control
 * character or starts with `-` (branchling would read it as a flag), a scope
 * outside TASK_SCOPES, and a scope beside a status are a 400.
 *
 * status, priority and board are closed vocabularies in branchling 0.2.0: a
 * name outside them is a usage error with stderr only. They are names the
 * user typed, so that is `422 rejected-input` (src/request-error.mjs, UI-21),
 * never the interface-bug `500 usage-error` and never an empty list. No
 * command of the pin gives those vocabularies as data, so the declared lists
 * are `null` (unknown), not empty. epic, owner, label and text are free:
 * an unknown value simply matches nothing.
 */

import { RequestError, rejectingTypedInput } from "../request-error.mjs";
import { TASK_FILTER_KEYS, validateTaskFilters } from "../view-model/tasks.mjs";

/** The filters whose values branchling checks against config.yaml. */
const CLOSED_VOCABULARY = ["status", "priority", "board"];

export function taskFiltersParam(params) {
  const input = {};
  for (const key of [...TASK_FILTER_KEYS, "scope"]) {
    const value = params.get(key);
    if (value !== null) input[key] = value;
  }
  const checked = validateTaskFilters(input);
  if (!checked.ok) throw new RequestError(checked.message);
  return checked.value;
}

export default {
  id: "tasks",
  routes: [
    {
      method: "GET",
      path: "/api/tasks",
      handler: ({ adapter, params }) => {
        const filters = taskFiltersParam(params);
        const typed = Object.fromEntries(CLOSED_VOCABULARY.filter(k => filters[k]).map(k => [k, filters[k]]));
        return rejectingTypedInput(typed, () => adapter.query(filters), async () => ({}));
      },
    },
  ],
};
