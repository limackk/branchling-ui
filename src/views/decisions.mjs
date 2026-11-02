/**
 * The decisions view's API (UI-5).
 *
 *   GET  /api/decisions   every open question, the adapter's composed
 *                         `decisions` answer (see listDecisions in src/adapter.mjs)
 *   POST /api/decide      `{ id, resolves, choose }` or `{ id, resolves, reason }`
 *                         runs `branchling decide` and answers with what it printed
 *
 * The POST sits behind the server's write guard (Host, Origin and the
 * capability token), which runs before any handler; nothing here repeats it.
 * The body arrives parsed and size-limited from the server. Its shape is
 * checked by the same `validateDecision` the page uses, and a malformed one is
 * a 400 before branchling is called. No actor is passed: branchling resolves
 * it from the environment of the person who started the server
 * (`$BACKLOG_ACTOR`, then their user config). A refusal from `decide` reaches
 * the page as the server's 409 refusal, its text unchanged.
 */

import { validateDecision } from "../view-model/decisions.mjs";
import { RequestError } from "../request-error.mjs";
import { listDecisions } from "../adapter.mjs";

export default {
  id: "decisions",
  routes: [
    {
      method: "GET",
      path: "/api/decisions",
      handler: ({ adapter }) => listDecisions(adapter),
    },
    {
      method: "POST",
      path: "/api/decide",
      handler: ({ adapter, body }) => {
        const checked = validateDecision(body);
        if (!checked.ok) throw new RequestError(checked.message);
        return adapter.decide(checked.value);
      },
    },
  ],
};
