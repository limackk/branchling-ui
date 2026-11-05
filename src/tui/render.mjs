/**
 * A screen as lines of text. A pure function of the shared view model
 * (src/view-model/), a width, a height and a colour flag: no I/O, no
 * `process`, so the tests render it without a terminal.
 *
 * It decides layout and nothing else. Counts, labels, sentences and which
 * state applies come from the view model, so the terminal and the web page
 * cannot drift. Which screen draws the body is the model's `view`, looked up
 * in the registry (src/tui/screens/index.mjs); loading, error, refusal,
 * rejected and stale are drawn here for every screen alike. Colour is never
 * the only signal: every value has its label.
 *
 * Only the 16 ANSI colours are used (SGR 30-37 and 90-97, plus bold and dim),
 * so the user's terminal theme decides what they look like. Statuses and
 * priorities are styled by ROLE, never by name; the role comes from the
 * `vocabulary` envelope (UI-18, src/view-model/roles.mjs) and is neutral when
 * the installed branchling cannot give it.
 *
 * On the full screen the header and the key map stay put and the body
 * scrolls: when it is taller than the room, the row above the key map says
 * which lines are shown and how to see the rest, so nothing is cut silently.
 */

import { SCREENS, screenById } from "./screens/index.mjs";
import { stateLines, staleLines } from "./screens/states.mjs";
import { ROLE_STYLE, SGR, clean, fit, paint, seg, width } from "./text.mjs";

export { ROLE_STYLE, clean };

/**
 * The keys the screen offers, in the order the key map shows them. `inputs`
 * maps each character that presses the key to the action the loop runs; a
 * character in no entry does nothing, so a key cannot work without being on
 * the map.
 */
export const KEYS = [
  ...SCREENS.map(s => ({ key: s.key, label: s.label, inputs: { [s.key]: `screen:${s.id}` } })),
  { key: "tab", label: "next", inputs: { "\t": "next" } },
  { key: "j/k", label: "scroll", inputs: { j: "down", k: "up", J: "down", K: "up" } },
  { key: "r", label: "refresh", inputs: { r: "refresh", R: "refresh" } },
  { key: "q", label: "quit", inputs: { q: "quit", Q: "quit" } },
];

/** The action a typed character stands for under `keys`, or null. */
export function actionFor(ch, keys = KEYS) {
  for (const k of keys) if (k.inputs && Object.prototype.hasOwnProperty.call(k.inputs, ch)) return k.inputs[ch];
  return null;
}

function screenOf(model) {
  return screenById(model && model.view) || SCREENS[0];
}

function headerLine(model, screen, max) {
  const header = [seg("branchling-ui", SGR.bold), seg(`  ${screen.title}`)];
  if (model.root) {
    // The end of a path tells backlogs apart; its start rarely does.
    const room = max - width(header) - 2;
    const chars = [...clean(model.root)];
    const root = chars.length > room && room > 1 ? "…" + chars.slice(chars.length - room + 1).join("") : chars.join("");
    header.push(seg("  "), seg(root, SGR.dim));
  }
  return header;
}

function bodyLines(model, screen, max) {
  const state = stateLines(model, max, screen.text.loading);
  if (state) return state;
  return [...staleLines(model, max, screen.text.stale), ...screen.body(model, max)];
}

function keyMap(keys, current) {
  const map = [];
  keys.forEach((k, i) => {
    if (i) map.push(seg("  "));
    const here = k.inputs && k.inputs[k.key] === `screen:${current}`;
    map.push(seg(k.key, `${SGR.bold};${SGR.cyan}`), seg(` ${k.label}`, here ? SGR.bold : null));
  });
  return map;
}

/** Rows the body may use on a full screen of `height` rows: all but header, rule and key map. */
function room(height) {
  return Math.max(height - 3, 1);
}

/**
 * The furthest the body of `model` can be scrolled on a full screen, so the
 * loop never counts past the end.
 */
export function maxScroll(model, { width: w, height } = {}) {
  const max = Number.isInteger(w) && w > 0 ? w : 80;
  const rows = Number.isInteger(height) && height > 0 ? height : 24;
  const total = bodyLines(model, screenOf(model), max).length;
  const space = room(rows);
  return total > space ? total - (space - 1) : 0;
}

/**
 * @param {object} model a view model or a state from src/view-model/; its
 *   `view` picks the screen
 * @param {{ width?: number, height?: number, colour?: boolean, keys?: object[], offset?: number }} [options]
 *   `height` and `keys` are for the full screen: the body scrolls by `offset`
 *   lines between the header and the key map pinned to the last row. Without
 *   them every line is returned, for printing once.
 * @returns {string[]} one string per line, none wider than `width` columns
 */
export function renderScreen(model, { width: w, height, colour = false, keys, offset = 0 } = {}) {
  const max = Number.isInteger(w) && w > 0 ? w : 80;
  const screen = screenOf(model);
  const head = [headerLine(model, screen, max), [seg("─".repeat(max), SGR.dim)]];
  let body = bodyLines(model, screen, max);
  let lines;

  if (keys && keys.length) {
    const rows = Number.isInteger(height) && height > 0 ? height : head.length + body.length + 1;
    const space = room(rows);
    if (body.length > space) {
      const shown = Math.max(space - 1, 0);
      const top = Math.min(Math.max(Number(offset) || 0, 0), body.length - shown);
      const last = top + shown;
      const where = shown
        ? `lines ${top + 1}-${last} of ${body.length}`
        : `${body.length} lines`;
      const hint = [top > 0 ? "k up" : null, last < body.length ? "j down" : null].filter(Boolean).join(", ");
      body = [...body.slice(top, last), [seg(`── ${where}${hint ? ` · ${hint}` : ""} ──`, SGR.dim)]];
    }
    lines = [...head, ...body].slice(0, Math.max(rows - 1, 0));
    while (lines.length < rows - 1) lines.push([]);
    lines.push(keyMap(keys, screen.id));
  } else {
    lines = [...head, ...body];
  }
  return lines.map(segs => paint(fit(segs, max), colour));
}
