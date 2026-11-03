/**
 * WCAG contrast of every token pair the page uses, in light and dark, read from
 * src/web/styles.css. Exits 1 if any pair is under its minimum (4.5:1 for text,
 * 3:1 for borders, focus rings and other marks a reader must see), or if a token
 * cannot be resolved to a colour in either scheme. Add a pair here when a view
 * starts using a new combination of tokens.
 *
 *   node .agents/skills/ui-verify/contrast.mjs
 *
 * The tokens are the Ledger system's (docs/design/tokens.css, copied into
 * styles.css): each semantic token is one `light-dark(<light>, <dark>)`
 * declaration on :root, pointing at primitives with var() or giving a hex.
 * The script resolves var() chains and picks the light or the dark branch. A
 * separate dark block (`@media (prefers-color-scheme: dark) { :root { … } }`,
 * the format before the design system) is still read and wins for dark, so a
 * token written either way is checked.
 */

import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../../src/web/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The custom properties declared in every `:root { … }` block outside a media query, in order. */
function declarations(text) {
  const out = {};
  for (const m of text.matchAll(/--([\w-]+)\s*:\s*([^;}]+)[;}]/g)) out[m[1]] = m[2].trim();
  return out;
}
function blocks(re) {
  return [...css.matchAll(re)].map(m => m[1]).join("\n");
}
const base = declarations(blocks(/(?:^|})\s*:root\s*{([^}]*)}/g));
const darkOverrides = declarations(blocks(/prefers-color-scheme:\s*dark\)\s*{\s*:root(?::not\([^)]*\))?\s*{([^}]*)}/g));

/** Splits `a, b` at the top-level comma. */
function splitTop(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  }
  return [s.trim()];
}

/** A token's colour in one scheme as #rrggbb, or null when it is not a solid colour. */
function resolve(value, scheme, seen = new Set()) {
  value = value.trim();
  const ld = value.match(/^light-dark\(([\s\S]*)\)$/);
  if (ld) {
    const [light, dark] = splitTop(ld[1]);
    return resolve(scheme === "dark" ? dark : light, scheme, seen);
  }
  const v = value.match(/^var\(--([\w-]+)\)$/);
  if (v) return token(v[1], scheme, seen);
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) return "#" + [...value.slice(1)].map(c => c + c).join("").toLowerCase();
  return null;
}
function token(name, scheme, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  const raw = scheme === "dark" && name in darkOverrides ? darkOverrides[name] : base[name];
  return raw === undefined ? null : resolve(raw, scheme, seen);
}

const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const TEXT = 4.5;
const MARK = 3;
const SURFACES = ["color-bg-canvas", "color-bg-surface", "color-bg-raised", "color-bg-subtle"];

/** [foreground, background, minimum, where the page uses it]. */
const PAIRS = [
  // body text, secondary text and links on every surface a view draws
  ...SURFACES.map(bg => ["color-text-default", bg, TEXT, "body text"]),
  ...SURFACES.map(bg => ["color-text-muted", bg, TEXT, "meta, notes, labels, captions"]),
  ...SURFACES.map(bg => ["color-text-link", bg, TEXT, "task-id links, Close, rejected names"]),
  // the sidebar navigation
  ["color-text-default", "color-bg-hover", TEXT, "a view link under the pointer"],
  ["color-text-default", "color-bg-selected", TEXT, "the current view (aria-current), a selected radio card"],
  ["color-text-muted", "color-bg-selected", TEXT, "muted text in a selected radio card, a selected task row's meta"],
  ["color-text-link", "color-bg-selected", TEXT, "the id link of a selected task row (UI-26)"],
  // buttons
  ["color-text-on-action", "color-action-primary", TEXT, "a submit button"],
  ["color-text-on-action", "color-action-primary-hover", TEXT, "a submit button under the pointer"],
  ["color-text-default", "color-action-secondary", TEXT, "Try again, Clear"],
  ["color-text-default", "color-action-secondary-hover", TEXT, "a secondary button under the pointer"],
  ["color-action-disabled-fg", "color-action-disabled-bg", TEXT, "a decision being sent"],
  // status and priority roles (all neutral until UI-18; the six are styled)
  ...["neutral", "progress", "attention", "danger", "success", "muted"].map(r => [`role-${r}-fg`, `role-${r}-bg`, TEXT, `the ${r} role pill or tag`]),
  // view states
  ...["error", "refusal", "stale", "recorded"].map(s => [`state-${s}-fg`, `state-${s}-bg`, TEXT, `the ${s} state`]),
  // marks a reader must see (WCAG 1.4.11)
  ...SURFACES.map(bg => ["color-border-focus", bg, MARK, "the focus ring"]),
  ["color-border-focus", "color-bg-selected", MARK, "the focus ring on the current view"],
  ...["color-bg-canvas", "color-bg-surface", "color-bg-subtle"].map(bg => ["color-border-strong", bg, MARK, "input and radio-card borders, dashed unknown and later borders"]),
  ...["color-bg-canvas", "color-bg-surface"].map(bg => ["color-action-primary", bg, MARK, "the active wave's rail and border, the panel border, the current view bar"]),
  ["color-action-primary", "color-bg-selected", MARK, "the current view bar"],
  ["role-attention-dot", "color-bg-surface", MARK, "the question marker"],
  ["role-neutral-dot", "role-neutral-bg", MARK, "the dot in a role pill (the label carries the meaning; checked anyway)"],
  // the task panel's action dialogs (UI-30): a field's error, an input's border
  ["role-danger-fg", "color-bg-raised", TEXT, "a field's error in an action dialog (UI-30)"],
  ["color-border-strong", "color-bg-raised", MARK, "an input's border in an action dialog (UI-30)"],
];
// Not checked, on purpose: color-border-default is a decorative divider
// between parts of a card; no control or state is identified by it alone
// (inputs use border-strong). color-bg-overlay and the shadows are not solid.

let failed = 0;
let darkDiffers = 0;
for (const [scheme] of [["light"], ["dark"]]) {
  for (const [fg, bg, min, use] of PAIRS) {
    const a = token(fg, scheme);
    const b = token(bg, scheme);
    if (!a || !b) {
      failed++;
      console.log(`${scheme.padEnd(5)} ${fg} on ${bg}: FAIL (token ${!a ? fg : bg} does not resolve to a colour)`);
      continue;
    }
    if (scheme === "dark" && (a !== token(fg, "light") || b !== token(bg, "light"))) darkDiffers++;
    const r = ratio(a, b);
    if (r < min) failed++;
    console.log(`${scheme.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)}:1 ${r < min ? `FAIL (needs ${min}:1)` : "ok"}  [${use}]`);
  }
}
// A guard against reading the dark scheme wrongly: if no dark pair differs
// from its light pair, the dark values were never found.
if (!darkDiffers) {
  failed++;
  console.log("dark: FAIL (no dark value differs from light; the dark scheme was not read)");
}
console.log(`${PAIRS.length * 2} pairs checked (${PAIRS.length} per scheme), ${failed} failing`);
process.exit(failed ? 1 : 0);
