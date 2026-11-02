/**
 * WCAG contrast of every token pair the page uses, in light and dark, read from
 * src/web/styles.css. Exits 1 if any pair is under its minimum (4.5:1 for text,
 * 3:1 for borders and the focus ring). Add a pair here when a view adds a token.
 *
 *   node .agents/skills/ui-verify/contrast.mjs
 */

import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../../src/web/styles.css", import.meta.url), "utf8");
const block = s => Object.fromEntries([...s.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(m => [m[1], m[2]]));
const light = block(css.match(/:root\s*{([^}]*)}/)[1]);
const dark = { ...light, ...block(css.match(/prefers-color-scheme:\s*dark\)\s*{\s*:root\s*{([^}]*)}/)[1]) };

const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const PAIRS = [
  ["text", "bg", 4.5], ["text", "surface", 4.5],
  ["text-muted", "bg", 4.5], ["text-muted", "surface", 4.5],
  ["accent", "bg", 4.5], ["accent", "surface", 4.5],
  ["role-neutral-fg", "role-neutral-bg", 4.5],
  ["state-error-fg", "state-error-bg", 4.5],
  ["state-refusal-fg", "state-refusal-bg", 4.5],
  ["state-stale-fg", "state-stale-bg", 4.5],
  ["border", "bg", 3], ["border", "surface", 3],
  ["focus", "bg", 3], ["focus", "surface", 3],
];

let failed = 0;
for (const [scheme, tokens] of [["light", light], ["dark", dark]]) {
  for (const [fg, bg, min] of PAIRS) {
    if (!tokens[fg] || !tokens[bg]) { failed++; console.log(`${scheme} ${fg} on ${bg}: token missing`); continue; }
    const r = ratio(tokens[fg], tokens[bg]);
    if (r < min) failed++;
    console.log(`${scheme.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)}:1 ${r < min ? `FAIL (needs ${min}:1)` : "ok"}`);
  }
}
process.exit(failed ? 1 : 0);
