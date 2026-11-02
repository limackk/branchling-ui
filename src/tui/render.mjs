/**
 * The stats screen as lines of text. A pure function of the shared view model
 * (src/view-model/), a width, a height and a colour flag: no I/O, no
 * `process`, so the tests render it without a terminal.
 *
 * It decides layout and nothing else. Counts, labels, sentences and which
 * state applies come from the view model, so the terminal and the web page
 * cannot drift. Colour is never the only signal: every value has its label.
 *
 * Only the 16 ANSI colours are used (SGR 30-37 and 90-97, plus bold and dim),
 * so the user's terminal theme decides what they look like. Statuses and
 * priorities are styled by ROLE, never by name; every role is neutral until
 * UI-18 brings the vocabulary from the CLI.
 */

import { STATS_TEXT } from "../view-model/stats.mjs";

const SGR = {
  bold: "1",
  dim: "2",
  red: "31",
  yellow: "33",
  cyan: "36",
};

/** Role name -> SGR parameters (16-colour only), or null for no styling. */
export const ROLE_STYLE = {
  neutral: null,
};

/** The keys the screen offers, in the order the key map shows them. */
export const KEYS = [
  { key: "q", label: "quit" },
  { key: "r", label: "refresh" },
];

/*
 * Text from a backlog (status keys, the root path, an error message) is data.
 * A control character in it could move the cursor or recolour the terminal,
 * so C0 and C1 controls, ESC included, are replaced before anything is shown.
 */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

export function clean(text) {
  return String(text ?? "").replace(CONTROL, "?");
}

function seg(text, style = null) {
  return { text: clean(text), style };
}

function width(segs) {
  return segs.reduce((n, s) => n + [...s.text].length, 0);
}

/** Cuts a line to `max` columns, ending in an ellipsis when it was longer. */
function fit(segs, max) {
  if (width(segs) <= max) return segs;
  const out = [];
  let left = max - 1;
  for (const s of segs) {
    if (left <= 0) break;
    const chars = [...s.text];
    out.push({ text: chars.slice(0, left).join(""), style: s.style });
    left -= Math.min(chars.length, left);
  }
  if (max > 0) out.push({ text: "…", style: null });
  return out;
}

function paint(segs, colour) {
  return segs.map(s => (colour && s.style ? `\x1b[${s.style}m${s.text}\x1b[0m` : s.text)).join("");
}

/** Words onto lines of at most `max` columns; a single longer word is cut later by fit(). */
function wrap(text, max) {
  const lines = [];
  let line = "";
  for (const word of clean(text).split(/ +/)) {
    if (line && [...line].length + 1 + [...word].length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function countRows(heading, rows, max) {
  const labelWidth = Math.min(Math.max(...rows.map(r => [...clean(r.label)].length), heading.length), Math.max(max - 12, 4));
  const pad = (text, n) => text + " ".repeat(Math.max(n - [...text].length, 0));
  const lines = [[seg(pad(heading, labelWidth + 2), SGR.bold), seg(STATS_TEXT.countHeading.padStart(8), SGR.dim)]];
  for (const row of rows) {
    const label = clean(row.label);
    const shown = [...label].length > labelWidth ? [...label].slice(0, labelWidth - 1).join("") + "…" : label;
    lines.push([seg("  "), seg(pad(shown, labelWidth), ROLE_STYLE[row.role] ?? null), seg(String(row.count).padStart(8))]);
  }
  return lines;
}

function body(model, max) {
  const lines = [];
  if (model.state === "loading") {
    lines.push([seg(STATS_TEXT.loading, SGR.dim)]);
    return lines;
  }
  if (model.state === "error" || model.state === "refusal") {
    // A refusal is an answer the user may act on, never an empty result.
    lines.push([seg(model.title, `${SGR.bold};${model.state === "refusal" ? SGR.yellow : SGR.red}`)]);
    for (const line of wrap(model.detail, max)) lines.push([seg(line)]);
    if (model.refusalKind) lines.push([seg("Reason code: ", SGR.dim), seg(model.refusalKind)]);
    return lines;
  }
  if (model.freshness && model.freshness.stale) {
    for (const line of wrap(STATS_TEXT.stale, max)) lines.push([seg(line, SGR.yellow)]);
  }
  const totals = [];
  model.totals.forEach((t, i) => {
    if (i) totals.push(seg("   "));
    totals.push(seg(`${t.label} `, SGR.dim), seg(String(t.value), SGR.bold));
  });
  lines.push(totals);
  if (model.state === "empty") {
    lines.push([], [seg(STATS_TEXT.empty)]);
    return lines;
  }
  lines.push([], ...countRows(STATS_TEXT.byStatus, model.byStatus, max));
  if (model.byPriority.length) lines.push([], ...countRows(STATS_TEXT.byPriority, model.byPriority, max));
  return lines;
}

/**
 * @param {object} model a stats model, or a loading, error or refusal state, from src/view-model/
 * @param {{ width?: number, height?: number, colour?: boolean, keys?: {key: string, label: string}[] }} [options]
 *   `height` and `keys` are for the full screen: the body is cut to fit and
 *   the key map is pinned to the last row. Without them the lines are
 *   returned as they are, for printing once.
 * @returns {string[]} one string per line, none wider than `width` columns
 */
export function renderScreen(model, { width: w, height, colour = false, keys } = {}) {
  const max = Number.isInteger(w) && w > 0 ? w : 80;
  const header = [seg("branchling-ui", SGR.bold), seg(`  ${STATS_TEXT.title}`)];
  if (model.root) {
    // The end of a path tells backlogs apart; its start rarely does.
    const room = max - width(header) - 2;
    const chars = [...clean(model.root)];
    const root = chars.length > room && room > 1 ? "…" + chars.slice(chars.length - room + 1).join("") : chars.join("");
    header.push(seg("  "), seg(root, SGR.dim));
  }
  let lines = [header, [seg("─".repeat(max), SGR.dim)], ...body(model, max)];

  if (keys && keys.length) {
    const map = [];
    keys.forEach((k, i) => {
      if (i) map.push(seg("  "));
      map.push(seg(k.key, `${SGR.bold};${SGR.cyan}`), seg(` ${k.label}`));
    });
    const rows = Number.isInteger(height) && height > 0 ? height : lines.length + 1;
    lines = lines.slice(0, Math.max(rows - 1, 0));
    while (lines.length < rows - 1) lines.push([]);
    lines.push(map);
  }
  return lines.map(segs => paint(fit(segs, max), colour));
}
