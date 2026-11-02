/**
 * The release pipeline screen (UI-31), from src/view-model/release.mjs, in
 * the web page's order: the refs the answer was computed from (the trunk
 * first), the planned release when one is compared, then one lane per deploy
 * target with a column per bucket branchling placed, and what could not be
 * placed. An unknown count reads "unknown", never 0; the last stage is
 * counted, not listed, as the model says.
 *
 * It is fed the way the page's default view is: `deploy status --json` with
 * no target and no release named.
 */

import { RELEASE_TEXT, releaseModel } from "../../view-model/release.mjs";
import { SGR, clean, heading, para, seg, taskLine } from "../text.mjs";

function refRows(model, max) {
  const rows = [
    { name: RELEASE_TEXT.trunk, ref: model.trunk.spec, sha: model.trunk.shaLabel, unknown: !model.trunk.sha, note: model.trunk.sourceText },
    ...model.refs.map(r => ({
      name: r.name,
      ref: r.ref && r.ref !== r.spec ? `${r.spec} → ${r.ref}` : r.spec,
      sha: r.shaLabel,
      unknown: !r.resolved,
      note: r.recorded,
    })),
  ];
  const nameWidth = Math.min(Math.max(...rows.map(r => [...clean(r.name)].length)), 24);
  const lines = [];
  for (const r of rows) {
    const name = clean(r.name);
    lines.push([
      seg("  "),
      seg(name + " ".repeat(Math.max(nameWidth - [...name].length, 0)), SGR.bold),
      seg(`  ${r.sha}`, r.unknown ? SGR.yellow : null),
      seg(`  ${r.ref}`, SGR.dim),
    ]);
    if (r.note) lines.push(...para(r.note, max, { style: SGR.dim, indent: 4 }));
  }
  return lines;
}

function columnLines(column, max) {
  const lines = [[
    seg("  "),
    seg(column.label),
    seg(`  ${column.countLabel}`, column.unknown ? `${SGR.bold};${SGR.yellow}` : SGR.bold),
  ]];
  for (const note of [column.unknownDetail, column.listedNote, column.longestWaitLabel]) {
    if (note) lines.push(...para(note, max, { style: SGR.dim, indent: 4 }));
  }
  for (const task of column.tasks) lines.push(taskLine(task, 4));
  return lines;
}

function releaseLines(rel, max) {
  const lines = [heading(`${RELEASE_TEXT.release} ${rel.name}`)];
  lines.push(...para(rel.countsText, max, { indent: 2 }));
  if (rel.currentText) lines.push(...para(rel.currentText, max, { style: SGR.dim, indent: 2 }));
  if (rel.shippedAtText) lines.push(...para(rel.shippedAtText, max, { style: rel.shippedAt && !rel.shippedAt.resolved ? SGR.yellow : SGR.dim, indent: 2 }));
  for (const sec of rel.sections) {
    lines.push([seg(`  ${sec.label}`), seg(`  ${sec.countLabel}`, sec.unknown ? `${SGR.bold};${SGR.yellow}` : SGR.bold)]);
    for (const task of sec.tasks) lines.push(taskLine(task, 4));
  }
  return lines;
}

export default {
  id: "release",
  key: "3",
  label: "release",
  title: RELEASE_TEXT.title,
  text: { loading: RELEASE_TEXT.loading, stale: RELEASE_TEXT.stale },

  read: adapter => adapter.deployStatus(),

  model: (envelope, freshness) => releaseModel(envelope, freshness),

  body(model, max) {
    const lines = [];
    if (model.state === "empty") {
      lines.push([seg(model.emptyState.title, SGR.bold)], ...para(model.emptyState.detail, max));
      if (model.release) lines.push([], ...releaseLines(model.release, max));
      return lines;
    }
    lines.push(heading(RELEASE_TEXT.refs), ...refRows(model, max));
    if (model.release) lines.push([], ...releaseLines(model.release, max));
    for (const lane of model.lanes) {
      lines.push([], heading(lane.target));
      if (lane.note) lines.push(...para(lane.note, max, { style: SGR.dim, indent: 2 }));
      for (const column of lane.columns) lines.push(...columnLines(column, max));
    }
    if (model.unplaced.text) lines.push([], ...para(model.unplaced.text, max, { style: SGR.dim }));
    return lines;
  },
};
