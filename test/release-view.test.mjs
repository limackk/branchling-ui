/**
 * The release view (UI-4): the adapter's deployStatus, the /api/release route
 * and the release view model, against the REAL branchling executable over
 * fixture repositories built in temporary directories.
 *
 * The pipeline fixture declares one deploy target, `web`, with two stages,
 * staging and production, each a ref under refs/deploys/web/. No branchling
 * command declares `deploy_targets` or `releases`, so the fixture appends them
 * to ITS OWN temporary config.yaml and moves ITS OWN refs with git, the way a
 * deployment would. Tasks are created and closed with branchling commands:
 *
 *   TASK-1  closed, its commit in production (the last stage: counted, not listed)
 *   TASK-2  closed, its commit in staging, waiting for production
 *   TASK-3  closed, its commit on the trunk, waiting for staging
 *   TASK-4  open, planned for release 1.1, no commit
 *
 * The second fixture declares no targets and must give the empty state.
 */

import "./fixtures/private-homes.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAdapter, run, BranchlingUsageError } from "../src/adapter.mjs";
import { createServer } from "../src/server.mjs";
import { releaseModel, findTask } from "../src/view-model/release.mjs";
import { fromApiError } from "../src/view-model/states.mjs";
import { RequestError, rejectingTypedInput } from "../src/request-error.mjs";
import { fixtureEnv, ignoreHomes } from "./fixtures/env.mjs";

const BIN = process.env.BRANCHLING_BIN || "branchling";
const BODY = JSON.stringify({
  goal: "A fixture task exists.",
  verification: [{ id: "noop", bash: "true", proves: "The fixture can be closed." }],
});

let pipe;   // { root, dir }
let bare;   // { root, dir }
let server;

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function branchling(root, args, opts) {
  const { code, stderr } = await run(BIN, args, { cwd: root, env: fixtureEnv(root), ...opts });
  assert.equal(code, 0, `branchling ${args.join(" ")} exited ${code}: ${stderr}`);
}

async function fixture(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const dir = join(root, "backlog");
  git(root, ["init", "-q", "-b", "main"]);
  ignoreHomes(root);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  await branchling(root, ["init", "--dir", dir, "--no-example", "--no-nudge"]);
  return { root, dir };
}

function commitAll(root, message) {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

/** One request to the server with exactly these headers (fetch cannot set Host). */
function call(srv, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: srv.port, path, headers: { host: `127.0.0.1:${srv.port}` } }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => {
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const adapterFor = fx => createAdapter({ bin: BIN, dir: fx.dir, cwd: fx.root });

before(async () => {
  pipe = await fixture("branchling-ui-release-");
  appendFileSync(join(pipe.dir, "config.yaml"), [
    "",
    "releases: [1.0, 1.1]",
    "",
    "deploy_targets:",
    "  - name: web",
    "    paths: [app/]",
    "    stages:",
    "      - { name: staging, ref: refs/deploys/web/staging }",
    "      - { name: production, ref: refs/deploys/web/production }",
    "",
  ].join("\n"));
  commitAll(pipe.root, "fixture backlog");
  for (const [title, release] of [["Shipped task", "1.0"], ["Staged task", "1.1"], ["Trunk task", "1.1"], ["Open task", "1.1"]]) {
    await branchling(pipe.root, ["new", "--title", title, "--priority", "P1", "--release", release, "--dir", pipe.dir], { input: BODY });
  }
  commitAll(pipe.root, "fixture tasks");
  mkdirSync(join(pipe.root, "app"));
  for (const n of [1, 2, 3]) {
    writeFileSync(join(pipe.root, "app", `f${n}.txt`), `${n}\n`);
    commitAll(pipe.root, `TASK-${n} change ${n}`);
    await branchling(pipe.root, ["done", `TASK-${n}`, "--dir", pipe.dir]);
    const sha = commitAll(pipe.root, `TASK-${n} close`);
    if (n === 1) git(pipe.root, ["update-ref", "refs/deploys/web/production", sha]);
    if (n === 2) git(pipe.root, ["update-ref", "refs/deploys/web/staging", sha]);
  }

  bare = await fixture("branchling-ui-release-none-");
  await branchling(bare.root, ["new", "--title", "Fixture task", "--priority", "P1", "--dir", bare.dir], { input: BODY });

  server = await createServer({ adapter: adapterFor(pipe), port: 0, log: () => {} });
});

after(async () => {
  await server?.close();
  for (const fx of [pipe, bare]) if (fx) rmSync(fx.root, { recursive: true, force: true });
});

/** Every string anywhere in `value`. */
function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

function isPlainData(value) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isPlainData);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return Object.values(value).every(isPlainData);
  return false;
}

// --- the proof: the view model built from the real envelope -----------------

test("a closed task lands in the bucket of the stage it waits for", async () => {
  const model = releaseModel(await adapterFor(pipe).deployStatus());
  assert.equal(model.state, "ready");
  assert.equal(model.lanes.length, 1);
  const [lane] = model.lanes;
  assert.equal(lane.target, "web");
  // One column per bucket: off the trunk, waiting for each of the two stages, reached.
  assert.deepEqual(lane.columns.map(c => [c.kind, c.stage]), [
    ["closed-off-trunk", null], ["waiting", "staging"], ["waiting", "production"], ["reached", "production"],
  ]);
  assert.deepEqual(findTask(model, "TASK-3"), { target: "web", kind: "waiting", stage: "staging", after: null, label: "on the trunk, waiting for staging" });
  assert.deepEqual(findTask(model, "TASK-2"), { target: "web", kind: "waiting", stage: "production", after: "staging", label: "in staging, waiting for production" });
  const [off, toStaging, toProduction, reached] = lane.columns;
  assert.equal(off.count, 0);
  assert.deepEqual(toStaging.tasks.map(t => t.id), ["TASK-3"]);
  assert.deepEqual(toProduction.tasks.map(t => t.id), ["TASK-2"]);
  assert.equal(toStaging.count, 1);
  // Waiting time is shown for every listed task and summarised per column.
  const waiting = toStaging.tasks[0];
  assert.equal(typeof waiting.waitedDays, "number");
  assert.equal(waiting.waitedLabel, `waiting ${waiting.waitedDays}d`);
  assert.equal(toStaging.longestWaitDays, waiting.waitedDays);
  assert.equal(waiting.statusLabel, "done");
  assert.equal(waiting.role, "neutral");
});

test("the last stage is counted, not listed", async () => {
  const model = releaseModel(await adapterFor(pipe).deployStatus());
  const reached = model.lanes[0].columns.at(-1);
  assert.equal(reached.kind, "reached");
  assert.equal(reached.count, 1);
  assert.equal(reached.listed, false);
  assert.equal(reached.listedNote, "counted, not listed");
  assert.deepEqual(reached.tasks, []);
  // Positive control: TASK-1 is the one counted there, and is listed nowhere.
  assert.equal(findTask(model, "TASK-1"), null);
  assert.notEqual(findTask(model, "TASK-2"), null);
});

test("the model names the trunk and every ref with its SHA", async () => {
  const model = releaseModel(await adapterFor(pipe).deployStatus());
  const head = git(pipe.root, ["rev-parse", "HEAD"]);
  assert.equal(model.trunk.sha, head);
  assert.equal(model.trunk.shortSha, head.slice(0, 12));
  assert.equal(model.trunk.source, "head");
  assert.deepEqual(model.refs.map(r => [r.name, r.spec, r.sha]), [
    ["web/staging", "refs/deploys/web/staging", git(pipe.root, ["rev-parse", "refs/deploys/web/staging"])],
    ["web/production", "refs/deploys/web/production", git(pipe.root, ["rev-parse", "refs/deploys/web/production"])],
  ]);
  assert.ok(model.refs.every(r => r.resolved));
});

test("a backlog with no deploy targets is the explanatory empty state, not an error", async () => {
  const envelope = await adapterFor(bare).deployStatus();
  assert.equal(envelope.kind, "release-status");
  const model = releaseModel(envelope);
  assert.equal(model.state, "empty");
  assert.deepEqual(model.lanes, []);
  assert.equal(model.emptyState.reason, "no-targets");
  assert.equal(model.emptyState.title, "No deploy targets");
  assert.match(model.emptyState.detail, /deploy_targets/);
  // Positive control: the same builder answers "ready" with a target declared.
  assert.equal(releaseModel(await adapterFor(pipe).deployStatus()).state, "ready");
  assert.equal(releaseModel(await adapterFor(pipe).deployStatus()).emptyState, null);
});

test("a stage whose ref does not resolve is unknown, never zero", async () => {
  const staging = git(pipe.root, ["rev-parse", "refs/deploys/web/staging"]);
  git(pipe.root, ["update-ref", "-d", "refs/deploys/web/staging"]);
  let model;
  try {
    model = releaseModel(await adapterFor(pipe).deployStatus());
  } finally {
    git(pipe.root, ["update-ref", "refs/deploys/web/staging", staging]);
  }
  const [off, toStaging, toProduction, reached] = model.lanes[0].columns;
  for (const column of [toStaging, toProduction, reached]) {
    assert.equal(column.unknown, true, column.label);
    assert.equal(column.count, null, column.label);
    assert.equal(column.countLabel, "unknown", column.label);
    assert.deepEqual(column.unknownRefs, ["refs/deploys/web/staging"], column.label);
    assert.match(column.unknownDetail, /refs\/deploys\/web\/staging does not resolve/);
    assert.equal(column.longestWaitDays, null);
  }
  // branchling still says 0 for production beside unknown: the model must not.
  assert.equal(reached.listedNote, null);
  assert.ok(toStaging.tasks.every(t => t.unknown));
  // Positive control: the bucket before the unreadable stage is still judged.
  assert.equal(off.unknown, false);
  assert.equal(off.count, 0);
  const ref = model.refs.find(r => r.stage === "staging");
  assert.equal(ref.resolved, false);
  assert.equal(ref.sha, null);
  assert.match(ref.shaLabel, /^unknown: /);
});

test("--release compares the plan of a release with what shipped", async () => {
  const envelope = await adapterFor(pipe).deployStatus({ release: "1.1" });
  assert.equal(envelope.kind, "release-status");
  const model = releaseModel(envelope);
  const rel = model.release;
  assert.equal(rel.name, "1.1");
  assert.equal(rel.planned, 3);
  assert.equal(rel.shipped, 0);
  assert.equal(rel.isCurrent, true);
  const byKey = Object.fromEntries(rel.sections.map(s => [s.key, s]));
  assert.deepEqual(rel.sections.map(s => s.key), ["notShipped", "open", "unplanned", "dropped"]);
  assert.deepEqual(byKey.notShipped.tasks.map(t => t.id), ["TASK-2", "TASK-3", "TASK-4"]);
  assert.deepEqual(byKey.notShipped.tasks.find(t => t.id === "TASK-2").details, ["web: in staging, waiting for production"]);
  assert.deepEqual(byKey.notShipped.tasks.find(t => t.id === "TASK-3").details, ["web: on the trunk, waiting for staging"]);
  assert.deepEqual(byKey.notShipped.tasks.find(t => t.id === "TASK-4").details, ["no commit on the trunk names it"]);
  assert.deepEqual(byKey.open.tasks.map(t => t.id), ["TASK-4"]);
  // The pipeline is still there beside the comparison.
  assert.equal(model.lanes.length, 1);

  // Positive control: release 1.0 shipped its one task, and the plain call has no comparison.
  const shipped = releaseModel(await adapterFor(pipe).deployStatus({ release: "1.0" })).release;
  assert.equal(shipped.planned, 1);
  assert.equal(shipped.shipped, 1);
  assert.equal(shipped.isCurrent, false);
  assert.equal(releaseModel(await adapterFor(pipe).deployStatus()).release, null);
});

test("--target selects one declared target; an undeclared one is a usage error", async () => {
  const envelope = await adapterFor(pipe).deployStatus({ target: "web" });
  assert.equal(envelope.filter.target, "web");
  assert.equal(releaseModel(envelope).filter.target, "web");
  await assert.rejects(adapterFor(pipe).deployStatus({ target: "no-such-target" }), BranchlingUsageError);
});

test("an undeclared release is a usage error, never an empty comparison", async () => {
  await assert.rejects(adapterFor(pipe).deployStatus({ release: "9.9" }), err => err instanceof BranchlingUsageError && /9\.9/.test(err.stderr));
  // A value shaped like a flag never reaches branchling as one.
  await assert.rejects(adapterFor(pipe).deployStatus({ release: "--count" }), BranchlingUsageError);
  // Positive control: a declared one answers.
  assert.equal((await adapterFor(pipe).deployStatus({ release: "1.1" })).release.name, "1.1");
});

// --- the route ----------------------------------------------------------------

test("GET /api/release returns the release-status envelope", async () => {
  const res = await call(server, "/api/release");
  assert.equal(res.status, 200);
  assert.equal(res.json.kind, "release-status");
  assert.equal(res.json.schemaVersion, 1);
  const direct = await adapterFor(pipe).deployStatus();
  assert.deepEqual(res.json.targets, direct.targets);
  assert.equal(res.json.release, null);
});

test("the release and target query parameters pass through to branchling", async () => {
  const res = await call(server, "/api/release?release=1.1&target=web");
  assert.equal(res.status, 200);
  assert.equal(res.json.release.name, "1.1");
  assert.equal(res.json.filter.target, "web");
  // Positive control: an empty parameter is the same as none.
  const plain = await call(server, "/api/release?release=&target=");
  assert.equal(plain.status, 200);
  assert.equal(plain.json.release, null);
});

test("an undeclared typed name through the route is 422 rejected-input, never an empty answer", async () => {
  const res = await call(server, "/api/release?release=nope");
  assert.equal(res.status, 422);
  assert.equal(res.json.error.type, "rejected-input");
  assert.deepEqual(res.json.error.input, { release: "nope" });
  // branchling (0.2.0 and 0.3.0) gives no declared releases as data: unknown, not empty.
  assert.deepEqual(res.json.error.declared, { release: null });
  // branchling's own message, verbatim, for a person to read.
  assert.match(res.json.error.detail, /nope/);
  assert.equal(res.json.kind, undefined);
  assert.equal(res.json.targets, undefined);
  const model = fromApiError("release", res.json, res.status);
  assert.equal(model.state, "rejected");
  assert.equal(model.title, "No release named \u201cnope\u201d is declared");

  // Positive control: the plain call and a declared name still answer 200.
  assert.equal((await call(server, "/api/release")).status, 200);
  assert.equal((await call(server, "/api/release?release=1.1")).status, 200);
});

test("an undeclared typed target lists the declared targets from branchling's own envelope", async () => {
  const res = await call(server, "/api/release?target=nope&release=1.1");
  assert.equal(res.status, 422);
  assert.deepEqual(res.json.error.input, { target: "nope", release: "1.1" });
  assert.deepEqual(res.json.error.declared, { target: ["web"], release: null });
  const model = fromApiError("release", res.json, res.status);
  assert.equal(model.state, "rejected");
  // The release cannot be judged without a list, so both names are named.
  assert.deepEqual(model.names.map(n => n.key), ["target", "release"]);
  assert.deepEqual(model.names.find(n => n.key === "target").declared, ["web"]);
  // Positive control: the declared target answers.
  assert.equal((await call(server, "/api/release?target=web")).status, 200);
});

test("a usage error on a call with no typed name stays the interface-bug error", async () => {
  const adapter = adapterFor(pipe);
  // A flag this package built wrongly, against the real executable.
  await assert.rejects(rejectingTypedInput({}, () => adapter.raw(["deploy", "status", "--no-such-flag"], "release-status")), BranchlingUsageError);
  await assert.rejects(rejectingTypedInput({ release: "" }, () => adapter.raw(["deploy", "status", "--no-such-flag"], "release-status")), BranchlingUsageError);
  // The same failure with a typed name becomes rejected-input...
  await assert.rejects(rejectingTypedInput({ release: "nope" }, () => adapter.deployStatus({ release: "nope" })),
    err => err instanceof RequestError && err.status === 422 && err.type === "rejected-input");
  // ...and a refusal or a success passes through untouched.
  assert.equal((await rejectingTypedInput({ release: "1.1" }, () => adapter.deployStatus({ release: "1.1" }))).release.name, "1.1");
});

test("the route on a backlog without targets answers, and the page builds the empty state", async () => {
  const empty = await createServer({ adapter: adapterFor(bare), port: 0, log: () => {} });
  try {
    const res = await call(empty, "/api/release");
    assert.equal(res.status, 200);
    assert.equal(releaseModel(res.json).state, "empty");
  } finally {
    await empty.close();
  }
});

test("the page serves the release script and the release view model", async () => {
  for (const path of ["/release.mjs", "/view-model/release.mjs"]) {
    const res = await call(server, path);
    assert.equal(res.status, 200, path);
  }
  const page = await call(server, "/");
  assert.match(page.text, /id="release"/);
  const app = await call(server, "/app.mjs");
  // The page's view switcher maps ?view=release to the release module.
  assert.match(app.text, /release: "\/release\.mjs"/);
  assert.match(page.text, /data-view="release"/);
});

// --- plain data -----------------------------------------------------------------

test("the release model is plain data with no markup or escape codes", async () => {
  const models = [
    releaseModel(await adapterFor(pipe).deployStatus()),
    releaseModel(await adapterFor(pipe).deployStatus({ release: "1.1" })),
    releaseModel(await adapterFor(bare).deployStatus()),
  ];
  for (const model of models) {
    assert.ok(isPlainData(model));
    assert.deepEqual(JSON.parse(JSON.stringify(model)), model);
    const all = strings(model);
    assert.ok(all.length > 3, "positive control: the model has strings to check");
    for (const s of all) {
      assert.doesNotMatch(s, /<[a-z/!]/i, `markup in ${JSON.stringify(s)}`);
      assert.doesNotMatch(s, /\x1b/, `escape code in ${JSON.stringify(s)}`);
    }
  }
  const source = readFileSync(new URL("../src/view-model/release.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /#[0-9a-f]{3,6}\b|rgb\(|hsl\(/i, "no colour values in the model");
});

test("freshness is carried into the model, and anything but a release-status envelope is rejected", async () => {
  const envelope = await adapterFor(pipe).deployStatus();
  assert.deepEqual(releaseModel(envelope, { stale: true, fetchedAt: "2026-11-02T10:00:00Z" }).freshness, { stale: true, fetchedAt: "2026-11-02T10:00:00Z" });
  assert.deepEqual(releaseModel(envelope).freshness, { stale: false, fetchedAt: null });
  assert.throws(() => releaseModel({ schemaVersion: 1, kind: "stats", stats: {} }), TypeError);
  assert.throws(() => releaseModel(null), TypeError);
});
