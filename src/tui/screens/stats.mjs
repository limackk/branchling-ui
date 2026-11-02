/**
 * The stats screen (UI-16): totals, then counts by status and by priority,
 * from src/view-model/stats.mjs.
 */

import { STATS_TEXT, statsModel } from "../../view-model/stats.mjs";
import { ROLE_STYLE, SGR, clean, seg } from "../text.mjs";

function countRows(title, rows, max) {
  const labelWidth = Math.min(Math.max(...rows.map(r => [...clean(r.label)].length), title.length), Math.max(max - 12, 4));
  const pad = (text, n) => text + " ".repeat(Math.max(n - [...text].length, 0));
  const lines = [[seg(pad(title, labelWidth + 2), SGR.bold), seg(STATS_TEXT.countHeading.padStart(8), SGR.dim)]];
  for (const row of rows) {
    const label = clean(row.label);
    const shown = [...label].length > labelWidth ? [...label].slice(0, labelWidth - 1).join("") + "…" : label;
    lines.push([seg("  "), seg(pad(shown, labelWidth), ROLE_STYLE[row.role] ?? null), seg(String(row.count).padStart(8))]);
  }
  return lines;
}

export default {
  id: "stats",
  key: "1",
  label: "stats",
  title: STATS_TEXT.title,
  text: { loading: STATS_TEXT.loading, stale: STATS_TEXT.stale },

  read: adapter => adapter.stats(),

  model: (envelope, freshness) => statsModel(envelope, freshness),

  body(model, max) {
    const lines = [];
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
  },
};
