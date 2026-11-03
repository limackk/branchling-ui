/**
 * CI runs the suite against both ends of SUPPORTED_RANGE (UI-9).
 *
 * The `range-ends` job in .github/workflows/test.yml installs branchling from
 * npm at the lowest and the highest release the range admits. Its matrix is
 * written by hand, so it can go stale the day SUPPORTED_RANGE moves; this test
 * derives the two npm specs from SUPPORTED_RANGE alone (no network) and fails
 * unless the workflow names exactly those two and no other version.
 *
 * The workflow is read as text, not parsed as YAML: a YAML parser would be the
 * package's first dependency. The reader below only understands the shape the
 * job is written in, and anything it does not recognise is a failure.
 */

import "./fixtures/private-homes.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SUPPORTED_RANGE } from "../src/adapter.mjs";

const WORKFLOW = new URL("../.github/workflows/test.yml", import.meta.url);
const JOB = "range-ends";

/**
 * The npm specs of the two ends of a range. `lowest` is `min` exactly.
 * `highest` is every release from `min` up to `maxExclusive`, which npm
 * resolves to the newest one published, so a patch release inside the range
 * needs no edit; the lower bound keeps it from ever resolving below `min`.
 */
export function rangeEndSpecs({ min, maxExclusive }) {
  return [
    { end: "lowest", spec: min },
    { end: "highest", spec: `>=${min} <${maxExclusive}` },
  ];
}

/** The lines of one job under `jobs:`, from its key to the next job's. */
function jobLines(text, job) {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(`  ${job}:`);
  assert.notEqual(start, -1, `the workflow has no job ${job}`);
  let end = lines.findIndex((line, i) => i > start && /^ {0,2}\S/.test(line));
  if (end === -1) end = lines.length;
  return lines.slice(start + 1, end);
}

/**
 * The matrix `include:` entries of a job, as `{end, spec}` objects in order.
 * Only `- end: <name>` followed by `spec: "<spec>"` is understood.
 */
export function matrixEntries(text, job = JOB) {
  const lines = jobLines(text, job);
  const at = lines.findIndex(line => line.trim() === "include:");
  assert.notEqual(at, -1, `job ${job} has no matrix include`);
  const indent = lines[at].search(/\S/);
  const entries = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.trim()) continue;
    if (line.search(/\S/) <= indent) break;
    let m;
    if ((m = line.match(/^\s*- end: ([a-z]+)$/))) entries.push({ end: m[1] });
    else if ((m = line.match(/^\s*spec: "([^"]*)"$/)) && entries.length && !("spec" in entries.at(-1))) entries.at(-1).spec = m[1];
    else assert.fail(`unrecognised matrix line in job ${job}: ${line.trim()}`);
  }
  return entries;
}

/** Every x.y.z string in a job, comments included. */
export function versionsIn(text, job = JOB) {
  return jobLines(text, job).join("\n").match(/\d+\.\d+\.\d+/g) || [];
}

/** Fails unless the job names exactly the ends of `range` and no other version. */
export function assertMatrixMatches(text, range) {
  const expected = rangeEndSpecs(range);
  assert.deepEqual(matrixEntries(text), expected, "the matrix names the two ends of SUPPORTED_RANGE");
  const allowed = new Set([range.min, range.maxExclusive]);
  const stray = versionsIn(text).filter(v => !allowed.has(v));
  assert.deepEqual(stray, [], `job ${JOB} names no version outside the two ends`);
}

const workflow = readFileSync(WORKFLOW, "utf8");

test("the range-ends job names exactly the boundary specs derived from SUPPORTED_RANGE", () => {
  assertMatrixMatches(workflow, SUPPORTED_RANGE);
});

test("the job installs the matrix spec outside node_modules and runs the suite through BRANCHLING_BIN", () => {
  const job = jobLines(workflow, JOB).join("\n");
  assert.match(job, /SPEC: \$\{\{ matrix\.spec \}\}/);
  assert.match(job, /prefix="\$RUNNER_TEMP\/branchling-\$END"/, "outside the project's node_modules");
  assert.match(job, /npm install --prefix "\$prefix" --no-save --no-package-lock "branchling@\$SPEC"/);
  assert.match(job, /BRANCHLING_BIN=\$prefix\/node_modules\/\.bin\/branchling" >> "\$GITHUB_ENV"/);
  assert.match(job, /"\$BRANCHLING_BIN" --version/, "the log shows which build ran");
  assert.match(job, /if \(!supported\)[^\n]*process\.exit\(1\)/, "a resolution outside the range fails the job");
  assert.match(job, /run: node --test test\/\*\.test\.mjs$/m);
  assert.doesNotMatch(job, /npm ci/, "no pinned branchling in node_modules to fall back on");
});

test("positive control: the derivation follows the range it is given", () => {
  assert.deepEqual(rangeEndSpecs({ min: "0.2.0", maxExclusive: "0.3.0" }), [
    { end: "lowest", spec: "0.2.0" },
    { end: "highest", spec: ">=0.2.0 <0.3.0" },
  ]);
  assert.deepEqual(rangeEndSpecs({ min: "1.4.2", maxExclusive: "2.0.0" })[1], { end: "highest", spec: ">=1.4.2 <2.0.0" });
});

test("positive control: a stale, extra or missing end fails the check", () => {
  const { min, maxExclusive } = SUPPORTED_RANGE;
  const stale = workflow.replaceAll(min, "0.2.0").replaceAll(maxExclusive, "0.3.0");
  assert.throws(() => assertMatrixMatches(stale, SUPPORTED_RANGE), "a matrix left at an older range");
  assert.doesNotThrow(() => assertMatrixMatches(stale, { min: "0.2.0", maxExclusive: "0.3.0" }), "the same text matches the range it names");

  const extra = workflow.replace(`          - end: highest\n`, `          - end: middle\n            spec: "0.2.5"\n          - end: highest\n`);
  assert.notEqual(extra, workflow);
  assert.throws(() => assertMatrixMatches(extra, SUPPORTED_RANGE), "a third version");

  const pinnedHigh = workflow.replace(`spec: ">=${min} <${maxExclusive}"`, `spec: "${min}"`);
  assert.notEqual(pinnedHigh, workflow);
  assert.throws(() => assertMatrixMatches(pinnedHigh, SUPPORTED_RANGE), "a high end pinned to one release");

  const strayComment = workflow.replace(`  range-ends:\n`, `  range-ends:\n    # was 0.2.1\n`);
  assert.throws(() => assertMatrixMatches(strayComment, SUPPORTED_RANGE), "a version outside the ends, even in a comment");

  assert.throws(() => assertMatrixMatches(workflow.replace("  range-ends:", "  other-job:"), SUPPORTED_RANGE), "the job is gone");
});
