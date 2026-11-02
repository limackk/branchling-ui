/**
 * The building blocks every terminal screen is drawn with: styled segments,
 * fitting a line to the width, wrapping a sentence, painting with SGR codes.
 * Pure, no I/O, no `process`; shared by src/tui/render.mjs and the screens in
 * src/tui/screens/.
 *
 * A LINE is an array of segments `{ text, style }`. `style` is a string of SGR
 * parameters from the 16 ANSI colours (30-37, 90-97), bold and dim, or null.
 * Colour is applied only by `paint`, and only when the colour flag is on.
 */

export const SGR = {
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

/*
 * Text from a backlog (status keys, the root path, an error message) is data.
 * A control character in it could move the cursor or recolour the terminal,
 * so C0 and C1 controls, ESC included, are replaced before anything is shown.
 */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

export function clean(text) {
  return String(text ?? "").replace(CONTROL, "?");
}

export function seg(text, style = null) {
  return { text: clean(text), style };
}

export function width(segs) {
  return segs.reduce((n, s) => n + [...s.text].length, 0);
}

/** Cuts a line to `max` columns, ending in an ellipsis when it was longer. */
export function fit(segs, max) {
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

export function paint(segs, colour) {
  return segs.map(s => (colour && s.style ? `\x1b[${s.style}m${s.text}\x1b[0m` : s.text)).join("");
}

/** Words onto lines of at most `max` columns; a single longer word is cut later by fit(). */
export function wrap(text, max) {
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

/**
 * A sentence as whole lines: wrapped to the width after `indent` spaces, every
 * line in `style`. Nothing is cut: a sentence is meant to be read in full.
 */
export function para(text, max, { style = null, indent = 0 } = {}) {
  const pad = " ".repeat(indent);
  return wrap(text, Math.max(max - indent, 8)).map(line => [seg(pad + line, style)]);
}

/** A heading line: bold text, then an optional dim count in brackets. */
export function heading(text, count) {
  const out = [seg(text, SGR.bold)];
  if (count !== undefined && count !== null) out.push(seg(` (${count})`, SGR.dim));
  return out;
}

/**
 * One task as a row: id, title, status in its role, then the notes the model
 * gives, dimmed. The row is one line, cut with an ellipsis when it is longer
 * than the width; the id comes first so it is never the part cut.
 */
export function taskLine({ id, title, statusLabel, role, notes = [] }, indent = 2) {
  const out = [seg(" ".repeat(indent)), seg(id, SGR.bold)];
  if (title) out.push(seg(`  ${title}`));
  if (statusLabel) out.push(seg("  "), seg(statusLabel, ROLE_STYLE[role] ?? null));
  if (notes.length) out.push(seg(`  ${notes.join(" · ")}`, SGR.dim));
  return out;
}

/** An ISO time as the terminal shows it: date, minutes, UTC. */
export function shortTime(iso) {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/**
 * A shell command as whole lines, for copying: broken only between words
 * outside quotes, every line but the last ending in ` \` so the lines pasted
 * together are still the one command. Never cut with an ellipsis.
 */
export function commandLines(command, max, { style = null, indent = 0 } = {}) {
  const words = clean(command).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [""];
  const room = Math.max(max - indent - 4, 8); // two for the continuation indent, two for " \\"
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && [...line].length + 1 + [...word].length > room) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  lines.push(line);
  const pad = " ".repeat(indent);
  return lines.map((text, i) => [seg(pad + (i ? "  " : "") + text + (i < lines.length - 1 ? " \\" : ""), style)]);
}
