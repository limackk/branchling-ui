/**
 * The decisions screen (UI-31): every open question, oldest first, from
 * src/view-model/decisions.mjs. Answering is not done here: each question
 * shows the exact `branchling decide` command that answers it, from the view
 * model (`commands`), never with `--actor` (docs/architecture.md).
 *
 * It is fed the way the page is: listDecisions' `open-questions` answer, one
 * `log --open-questions` read through the same per-refresh scope, so it goes
 * through the cache.
 */

import { listDecisions } from "../../adapter.mjs";
import { DECISIONS_TEXT, decisionsModel } from "../../view-model/decisions.mjs";
import { SGR, commandLines, para, seg } from "../text.mjs";

function questionLines(q, max) {
  const lines = [[seg(q.taskId, SGR.bold), seg(`  ${q.title}`)]];
  lines.push(...para([q.statusLabel, `asked by ${q.askedBy}`, q.ageLabel].join(" · "), max, { style: SGR.dim, indent: 2 }));
  lines.push(...para(q.text, max, { indent: 2 }));
  for (const option of q.options) lines.push(...para(`${option.number}. ${option.label}`, max, { indent: 4 }));
  if (q.optionsNote) lines.push(...para(q.optionsNote, max, { style: SGR.dim, indent: 2 }));
  lines.push(...para(q.needs, max, { style: SGR.yellow, indent: 2 }));
  lines.push(...para(DECISIONS_TEXT.howToAnswer, max, { style: SGR.dim, indent: 2 }));
  // A command is broken with a continuation, never cut: it is meant to be copied whole.
  if (q.commands.choose) {
    lines.push(...commandLines(q.commands.choose, max, { style: SGR.cyan, indent: 4 }));
    lines.push(...para(DECISIONS_TEXT.chooseHint, max, { style: SGR.dim, indent: 4 }));
  }
  lines.push(...commandLines(q.commands.reason, max, { style: SGR.cyan, indent: 4 }));
  return lines;
}

export default {
  id: "decisions",
  key: "4",
  label: "decisions",
  title: DECISIONS_TEXT.title,
  text: { loading: DECISIONS_TEXT.loading, stale: DECISIONS_TEXT.stale },

  read: adapter => listDecisions(adapter),

  model: (answer, freshness, now) => decisionsModel(answer, freshness, now),

  body(model, max) {
    if (model.state === "empty") return [[seg(model.emptyText)]];
    const lines = [[seg(model.summary, SGR.bold)]];
    for (const q of model.questions) lines.push([], ...questionLines(q, max));
    lines.push([], ...para(DECISIONS_TEXT.actorNote, max, { style: SGR.dim }));
    return lines;
  },
};
