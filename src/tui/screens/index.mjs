/**
 * The terminal screens, in key order. A screen is one module here: its id,
 * its key, its title and loading/stale sentences, how it reads through the
 * adapter (`read`), which view model turns that into a model (`model`) and
 * how a ready or empty model becomes lines (`body`). Loading, error, refusal
 * and stale are drawn for every screen alike by src/tui/render.mjs.
 */

import stats from "./stats.mjs";
import plan from "./plan.mjs";
import release from "./release.mjs";
import decisions from "./decisions.mjs";

export const SCREENS = [stats, plan, release, decisions];

export function screenById(id) {
  return SCREENS.find(s => s.id === id) || null;
}
