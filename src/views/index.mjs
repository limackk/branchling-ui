/**
 * The view registry: the one list the server reads its API routes from.
 *
 * A view is its own module in this directory that default-exports
 *
 *   { id: "plan", routes: [{ method: "GET", path: "/api/plan", handler }] }
 *
 * where `handler({ adapter, req, url, params })` returns the JSON body (usually
 * an adapter envelope, unchanged) or throws one of the adapter's errors, which
 * the server maps to a JSON error response. A handler never spawns anything,
 * never touches the file system, and never writes a response itself.
 *
 * Adding a view is one import and one entry below, so views developed in
 * parallel (UI-3 plan, UI-4 release, UI-5 decisions) meet in two lines here
 * and nowhere else. Keep the list in alphabetical order to make those merges
 * trivial.
 */

import release from "./release.mjs";
import stats from "./stats.mjs";

export const views = [
  release,
  stats,
];
