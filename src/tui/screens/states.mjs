/**
 * The lines of the states every screen shares: loading, error, refusal and
 * rejected (src/view-model/states.mjs), and the stale notice. A refusal shows
 * its title, detail and reason code and never looks like an empty screen.
 */

import { SGR, para, seg } from "../text.mjs";

/**
 * @param {object} model any view model or state
 * @param {number} max the width
 * @param {string} loadingText the screen's own loading sentence
 * @returns {Array|null} the lines, or null when the model is ready or empty
 */
export function stateLines(model, max, loadingText) {
  if (model.state === "loading") return [[seg(loadingText, SGR.dim)]];
  if (model.state === "error" || model.state === "refusal") {
    const lines = [[seg(model.title, `${SGR.bold};${model.state === "refusal" ? SGR.yellow : SGR.red}`)]];
    lines.push(...para(model.detail, max));
    for (const line of Array.isArray(model.details) ? model.details : []) lines.push(...para(`- ${line}`, max));
    if (model.refusalKind) lines.push([seg("Reason code: ", SGR.dim), seg(model.refusalKind)]);
    return lines;
  }
  if (model.state === "rejected") {
    // A name the user typed that branchling rejected (UI-21): not a fault.
    const lines = [[seg(model.title, `${SGR.bold};${SGR.yellow}`)]];
    lines.push(...para(model.detail, max));
    for (const name of model.names) lines.push(...para(name.declaredText, max));
    if (model.branchlingSaid) lines.push(...para(`${model.branchlingSaidLabel}: ${model.branchlingSaid}`, max, { style: SGR.dim }));
    return lines;
  }
  return null;
}

/** The stale notice, when the model is the last answer shown while a new read runs. */
export function staleLines(model, max, text) {
  return model.freshness && model.freshness.stale ? para(text, max, { style: SGR.yellow }) : [];
}
