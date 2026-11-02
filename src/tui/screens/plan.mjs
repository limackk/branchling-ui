/**
 * The plan screen (UI-31), from src/view-model/plan.mjs, in the order the web
 * page asks its questions: where are we (the summary), what is happening (in
 * flight), what is next (may start now), the waves (a closed one shows its
 * heading only, as the page collapses it), what overtook the plan, and how
 * much is outside it.
 *
 * It is fed the way the page feeds the model: `plan --json` for the plan and
 * `query --json` for titles and dependencies, the second optional (without it
 * the model says `dependenciesKnown: false` and tasks are shown by id).
 */

import { PLAN_TEXT, planModel } from "../../view-model/plan.mjs";
import { SGR, heading, para, seg, shortTime, taskLine } from "../text.mjs";

const withWave = t => ({ ...t, notes: [...t.notes, `${PLAN_TEXT.wave.toLowerCase()} ${t.waveNumber}`] });

function tasks(list, emptyText, max) {
  if (!list.length) return para(emptyText, max, { style: SGR.dim, indent: 2 });
  return list.map(t => taskLine(t));
}

function waveLines(wave, max) {
  const head = [
    seg(`${PLAN_TEXT.wave} ${wave.number}`, SGR.bold),
    seg(`  ${wave.name}`),
    seg(`  [${wave.stateLabel}]`, wave.active ? `${SGR.bold};${SGR.cyan}` : SGR.dim),
    seg(`  ${wave.progressLabel}`, SGR.dim),
  ];
  const lines = [head];
  if (wave.collapsed) return lines;
  for (const group of wave.groups) lines.push(...para(`${PLAN_TEXT.together}: ${group.join(", ")}`, max, { style: SGR.dim, indent: 2 }));
  if (wave.endsOnHuman) lines.push(...para(PLAN_TEXT.endsOnHuman, max, { style: SGR.dim, indent: 2 }));
  lines.push(...tasks(wave.tasks, PLAN_TEXT.noTasksInWave, max));
  return lines;
}

export default {
  id: "plan",
  key: "2",
  label: "plan",
  title: PLAN_TEXT.title,
  text: { loading: PLAN_TEXT.loading, stale: PLAN_TEXT.stale },

  async read(adapter) {
    // The task list only adds titles and edges: its failure is not the plan's.
    const [plan, list] = await Promise.all([adapter.plan(), adapter.query().catch(() => null)]);
    return { plan, list };
  },

  model: ({ plan, list }, freshness) => planModel(plan, freshness, list),

  body(model, max) {
    const lines = [];
    if (model.state === "empty") {
      lines.push(...para(model.emptyReason === "no-plan" ? PLAN_TEXT.emptyNoPlan : PLAN_TEXT.emptyNoWaves, max));
      lines.push([], ...para(PLAN_TEXT.emptyHint, max, { style: SGR.dim }));
      return lines;
    }
    lines.push(...para(model.summary.parts.join(" · "), max, { style: SGR.bold }));
    const at = shortTime(model.freshness.fetchedAt);
    if (at) lines.push([seg(`${PLAN_TEXT.asOf} ${at}`, SGR.dim)]);
    if (model.rationale) lines.push([], [seg(PLAN_TEXT.rationale, SGR.dim)], ...para(model.rationale, max, { indent: 2 }));
    if (!model.dependenciesKnown) lines.push(...para(PLAN_TEXT.dependenciesUnknown, max, { style: SGR.yellow }));

    lines.push([], heading(PLAN_TEXT.inFlight, model.inFlight.length));
    lines.push(...tasks(model.inFlight.map(withWave), PLAN_TEXT.noneInFlight, max));

    lines.push([], heading(PLAN_TEXT.mayStartNow));
    if (!model.mayStartNow.length) {
      lines.push(...para(model.summary.finished ? PLAN_TEXT.finished : PLAN_TEXT.noneStartable, max, { style: SGR.dim, indent: 2 }));
    }
    for (const item of model.mayStartNow) {
      const human = item.waitsOnHuman ? [PLAN_TEXT.waitsOnHuman] : [];
      if (!item.together) {
        lines.push(taskLine({ ...item.tasks[0], notes: [...item.tasks[0].notes, ...human] }));
        continue;
      }
      lines.push([seg(`  ${[PLAN_TEXT.together, ...human].join(" · ")}`, SGR.dim)]);
      for (const t of item.tasks) lines.push(taskLine(t, 4));
    }

    lines.push([], heading(PLAN_TEXT.waves, model.waves.length));
    for (const wave of model.waves) lines.push(...waveLines(wave, max));

    if (model.overtaken.length) {
      lines.push([], heading(PLAN_TEXT.overtaken, model.overtaken.length));
      lines.push(...para(PLAN_TEXT.overtakenNote, max, { style: SGR.dim, indent: 2 }));
      lines.push(...model.overtaken.map(t => taskLine(withWave(t))));
    }

    lines.push([], heading(PLAN_TEXT.unplanned, model.unplanned.count));
    lines.push(...para(model.unplanned.sentence, max, { indent: 2 }));
    lines.push(...tasks(model.unplanned.tasks, PLAN_TEXT.allPlanned, max));
    lines.push([], ...para(PLAN_TEXT.footnote, max, { style: SGR.dim }));
    return lines;
  },
};
