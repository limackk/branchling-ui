/**
 * The task panel (UI-27) against the REAL branchling executable over a
 * fixture backlog built by that executable (test/fixtures/task-backlog.mjs).
 * The model is built from the answers the real `show`, `log` and `query`
 * print, so a key renamed upstream fails here rather than rendering nothing.
 *
 * The body comes from `show --json --body` (TL-542) and is drawn through the
 * safe markdown subset: proven here on the fixture's real bodies, on strings
 * for the subset's edges, and against a stub of a build without the flag,
 * where the panel says the body is not available rather than empty.
 */

import "./fixtures/private-homes.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAdapter, readTask, BranchlingRefusal } from "../src/adapter.mjs";
import { createServer } from "../src/server.mjs";
import { views } from "../src/views/index.mjs";
import {
  TASK_TEXT, bodyModel, historyModel, markdownBlocks, markdownInlines, safeHref,
  taskNotFound, taskPanelClosedHref, taskPanelFailure, taskPanelHref, taskPanelModel, taskParam,
} from "../src/view-model/task.mjs";
import { ANSWER, BIN, HTML_TITLE, QUESTION, TITLES, buildTaskBacklog } from "./fixtures/task-backlog.mjs";

let tmp;
let fixture;
let adapter;
let answers;

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

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

function call(srv, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: srv.port, path, headers: { host: `127.0.0.1:${srv.port}` } }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }));
    });
    req.on("error", reject);
    req.end();
  });
}

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "branchling-ui-task-panel-"));
  fixture = await buildTaskBacklog(join(tmp, "backlog-root"));
  adapter = createAdapter({ bin: BIN, dir: fixture.dir, cwd: fixture.root });
  answers = {};
  for (const id of ["TASK-1", "TASK-2", "TASK-3", "TASK-4"]) answers[id] = await readTask(adapter, id);
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/* ---------- the composed read, from the real executable ---------- */

test("the composed answer carries show, log, the task's row and what it blocks", () => {
  const a = answers["TASK-1"];
  assert.equal(a.kind, "task-panel");
  assert.equal(a.composed, true);
  assert.equal(a.show.kind, "task-show");
  assert.equal(a.log.kind, "task-log");
  assert.equal(a.task.id, "TASK-1");
  for (const key of ["owner", "epic", "labels", "estimate", "board", "release", "created", "updated"]) assert.ok(key in a.task, `the row has ${key}`);
  for (const key of ["ts", "actor", "source", "reason", "changes", "events", "messages"]) assert.ok(key in a.log.exchanges[0], `an exchange has ${key}`);
  assert.deepEqual(a.blocks.map(t => t.id), ["TASK-2"]);
});

test("a fixture task's fields are shown from its row, in the panel's order", () => {
  const model = taskPanelModel(answers["TASK-1"]);
  assert.equal(model.state, "ready");
  assert.equal(model.id, "TASK-1");
  assert.equal(model.title, TITLES["TASK-1"]);
  assert.equal(model.fieldsKnown, true);
  const field = key => model.fields.find(f => f.key === key);
  assert.deepEqual(model.fields.slice(0, 2).map(f => f.key), ["status", "priority"]);
  assert.equal(field("status").display, "pending", "decide moved it back from blocked");
  assert.equal(field("priority").display, "P1");
  assert.equal(field("epic").display, "Billing");
  assert.equal(field("estimate").display, "1d");
  assert.equal(field("board").display, "main");
  // An empty field says so instead of vanishing.
  assert.equal(field("release").value, null);
  assert.equal(field("release").display, TASK_TEXT.none);
  assert.ok(isPlainData(model));
  for (const s of strings(model)) assert.doesNotMatch(s, /<[a-z/!]|\x1b/i, s);
});

test("the history is every exchange in branchling's order, with its changes and reasons", () => {
  const { history } = taskPanelModel(answers["TASK-1"]);
  assert.deepEqual(history.entries.map(e => e.source), ["seed", "take", "ask", "ask", "decide"]);
  assert.equal(history.count, 5);
  assert.equal(history.sliced, false);
  const take = history.entries[1];
  assert.equal(take.actor, "agent:fixture");
  assert.deepEqual(take.changes.map(c => c.text), ["status: pending → in_progress", "owner: unassigned → agent:fixture"]);
  const asked = history.entries[2];
  assert.equal(asked.reason, QUESTION);
  assert.equal(asked.kind, "question");
  const decided = history.entries[4];
  assert.equal(decided.actor, "local:maja");
  assert.equal(decided.reason, ANSWER);
  assert.equal(decided.kind, "decision");
  assert.deepEqual(decided.changes.map(c => [c.field, c.from, c.to]), [["status", "blocked", "pending"]]);
  // An empty value is named, not left blank (ask clears the owner).
  assert.ok(history.entries[3].changes.some(c => c.text === "owner: agent:fixture → (empty)"));
  assert.throws(() => historyModel(answers["TASK-1"].show), TypeError);
});

test("blockers both ways: blocked by (with branchling's verdicts) and what it blocks", () => {
  const two = taskPanelModel(answers["TASK-2"], {}, "?view=plan");
  assert.equal(two.blockers.blocked, true);
  assert.deepEqual(two.blockers.blockedBy.map(b => [b.id, b.resolved, b.found]), [["TASK-1", false, true], ["TASK-4", true, true]]);
  assert.equal(two.blockers.blockedBy[0].href, "?view=plan&task=TASK-1", "a blocker opens in the panel over the same view");
  assert.deepEqual(two.blockers.blocks, []);
  // Positive control: TASK-1 blocks TASK-2 and is blocked by nothing.
  const one = taskPanelModel(answers["TASK-1"], {}, "?view=tasks&epic=Billing&task=TASK-1");
  assert.equal(one.blockers.blocked, false);
  assert.deepEqual(one.blockers.blockedBy, []);
  assert.deepEqual(one.blockers.blocks.map(b => [b.id, b.href]), [["TASK-2", "?view=tasks&epic=Billing&task=TASK-2"]]);
});

test("a closed task is found all the same: its row is read with --scope all", () => {
  const four = taskPanelModel(answers["TASK-4"]);
  assert.equal(answers["TASK-4"].task.id, "TASK-4", "the archived row came back from query");
  assert.equal(answers["TASK-4"].task.status, "done");
  assert.equal(four.status, "done");
  assert.equal(four.fieldsKnown, true);
  assert.deepEqual(four.blockers.blocks.map(b => b.id), ["TASK-2"], "TASK-2 waits on it (active, so listed)");
});

test("a title holding HTML stays the text it was written as", () => {
  const three = taskPanelModel(answers["TASK-3"]);
  assert.equal(three.title, HTML_TITLE);
  // The page puts text in through textContent only, never as markup.
  const page = read("src/web/task.mjs");
  assert.doesNotMatch(page, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment/);
  assert.match(page, /node\.textContent = value/);
  assert.match(page, /title\.textContent = text/);
});

/* ---------- the body (UI-37, through `show --json --body`, TL-542) ---------- */

const segmentsOf = blocks => blocks.flatMap(b => b.inlines || (b.items ? b.items.flatMap(i => i.inlines) : []));

test("a fixture task's real body renders as headings, lists, fenced and inline code, and links", () => {
  const a = answers["TASK-1"];
  assert.equal(typeof a.body, "string", "the composed answer carries the body show --body printed");
  assert.equal(a.body, a.show.body, "lifted from show, not read from anywhere else");
  const model = taskPanelModel(a);
  assert.equal(model.body.known, true);
  assert.equal(model.body.text, null, "a body with blocks needs no sentence");
  const blocks = model.body.blocks;
  assert.ok(isPlainData(blocks));
  const headings = blocks.filter(b => b.type === "heading").map(b => b.inlines.map(s => s.text).join(""));
  assert.deepEqual(headings.slice(0, 3), ["Goal", "Context", "Steps"]);
  const lists = blocks.filter(b => b.type === "list");
  assert.deepEqual(lists.map(l => l.ordered), [true, false], "the steps are ordered, the acceptance criteria are not");
  assert.deepEqual(lists[0].items.map(i => i.inlines.map(s => s.text).join("")), [
    "Find every place that rounds", "Round once, in totals()", "Compare a year of invoices against the export",
  ]);
  assert.deepEqual(blocks.filter(b => b.type === "code"), [{ type: "code", lang: "js", text: 'const total = round(sum(lines), "half-even");' }]);
  const segments = segmentsOf(blocks);
  assert.ok(segments.some(s => s.type === "code" && s.text === "accounting"), "an inline code span");
  assert.deepEqual(segments.filter(s => s.type === "link"), [{ type: "link", text: "the export notes", href: "https://example.com/export" }]);
  assert.ok(segments.some(s => s.type === "text" && s.text.includes("[a bad link](javascript:alert(1))")), "the unsafe link stays visible as text");
  assert.equal(blocks.filter(b => b.type === "paragraph").length >= 12, true, "every context paragraph is there");
});

test("HTML in a real body is shown as text, and an archived task's body is read all the same", () => {
  const model = taskPanelModel(answers["TASK-3"]);
  assert.equal(model.body.known, true);
  const segments = segmentsOf(model.body.blocks);
  for (const s of segments) assert.ok(["text", "code", "link"].includes(s.type), s.type);
  const text = segments.map(s => s.text).join("");
  for (const markup of ["<script>alert('body')</script>", "<b>markup</b>", "<img src=x onerror=alert(2)>"]) {
    assert.ok(text.includes(markup), `${markup} is text`);
  }
  // The page draws blocks through textContent only; the title test checks the rest of that file.
  assert.match(read("src/web/task.mjs"), /model\.body\.known && model\.body\.blocks\.length/);
  // TASK-4 is done, so archived: show --body still reaches its file.
  const four = taskPanelModel(answers["TASK-4"]);
  assert.equal(four.body.known, true);
  assert.match(answers["TASK-4"].body, /The helper nobody calls any more is gone\./);
});

test("the panel route carries the body, and an empty body is said to be empty", async () => {
  const server = await createServer({ adapter, port: 0, log: () => {} });
  try {
    const res = await call(server, "/api/task/panel?id=TASK-1");
    assert.equal(res.status, 200);
    assert.equal(res.json.body, answers["TASK-1"].body);
  } finally {
    await server.close();
  }
  assert.equal(bodyModel("").known, true);
  assert.equal(bodyModel("").text, TASK_TEXT.bodyEmpty);
});

/**
 * A build without `--body` (branchling 0.3.0 as published): the flag is a
 * usage error, anything else is answered with a minimal task-show. Every
 * spawn appends a line to `calls`, so the test can count them.
 */
function preBodyBin(root) {
  const envelope = '{"schemaVersion":1,"kind":"task-show","ok":true,"id":"TASK-1","status":"pending","priority":"P1","title":"t","blocked":false,"blockers":[]}';
  const calls = join(root, "calls");
  const file = join(root, process.platform === "win32" ? "pre-body.cmd" : "pre-body");
  if (process.platform === "win32") {
    writeFileSync(file, [
      "@echo off",
      `echo %*>>"${calls}"`,
      "for %%a in (%*) do if \"%%~a\"==\"--body\" (echo branchling show: unknown flag: --body 1>&2 & exit /b 2)",
      `echo ${envelope}`,
      "",
    ].join("\r\n"));
  } else {
    writeFileSync(file, [
      "#!/bin/sh",
      `echo "$*" >> '${calls}'`,
      'for a in "$@"; do if [ "$a" = "--body" ]; then echo "branchling show: unknown flag: --body" >&2; exit 2; fi; done',
      `echo '${envelope}'`,
      "",
    ].join("\n"));
  }
  chmodSync(file, 0o755);
  return { file, calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split(/\r?\n/) : []) };
}

test("a build without show --body leaves the body unavailable, never empty, and is asked once", async () => {
  const root = mkdtempSync(join(tmp, "pre-body-"));
  const stub = preBodyBin(root);
  const old = createAdapter({ bin: stub.file, dir: root });
  const first = await old.show("TASK-1", { body: true });
  assert.equal(first.kind, "task-show");
  assert.equal("body" in first, false);
  assert.equal(stub.calls().length, 2, "the refused --body, then the read without it");
  await old.show("TASK-1", { body: true });
  assert.equal(stub.calls().length, 3, "the refusal is remembered: no second --body");
  assert.ok(stub.calls().slice(1).every(line => !line.includes("--body")));
  const model = bodyModel(typeof first.body === "string" ? first.body : null);
  assert.equal(model.known, false);
  assert.equal(model.text, TASK_TEXT.bodyUnavailable);
  // Any other usage error still throws: a bin that does not exist is not "no body".
  await assert.rejects(createAdapter({ bin: join(root, "no-such-bin"), dir: root }).show("TASK-1", { body: true }));
  // Positive control: the real executable accepts the flag and gives a string.
  const real = await adapter.show("TASK-1", { body: true });
  assert.equal(typeof real.body, "string");
  assert.equal((await adapter.show("TASK-1")).body ?? null, null, "without the flag there is no body");
});

/* ---------- not found ---------- */

test("an unknown id is branchling's no-such-task refusal, which the model makes the not-found state", async () => {
  await assert.rejects(readTask(adapter, "TASK-99"), err => err instanceof BranchlingRefusal && err.envelope.refusalKind === "no-such-task");
  const server = await createServer({ adapter, port: 0, log: () => {} });
  try {
    const res = await call(server, "/api/task/panel?id=TASK-99");
    assert.equal(res.status, 409);
    const model = taskPanelFailure("TASK-99", res.json, res.status);
    assert.equal(model.state, "not-found");
    assert.equal(model.title, "No task TASK-99");
    assert.match(model.branchlingSaid, /TASK-99/);
  } finally {
    await server.close();
  }
  // Positive controls: another refusal stays a refusal, a failure an error.
  assert.equal(taskPanelFailure("TASK-1", { error: { type: "refusal", refusalKind: "held", message: "no" } }, 409).state, "refusal");
  assert.equal(taskPanelFailure("TASK-1", { error: { type: "contract-mismatch", message: "x" } }, 502).state, "error");
  // A value that is not an id at all is not found either, without a read.
  const junk = taskNotFound("--help");
  assert.equal(junk.state, "not-found");
  assert.equal(junk.title, TASK_TEXT.notAnIdTitle);
});

/* ---------- the route ---------- */

test("the panel route answers from the real executable, and a bad id costs no spawn", async () => {
  let spawns = 0;
  const counted = {
    ...adapter,
    show: id => { spawns++; return adapter.show(id); },
    log: (...a) => { spawns++; return adapter.log(...a); },
    query: (...a) => { spawns++; return adapter.query(...a); },
    setFields: () => { spawns++; return adapter.setFields(); },
  };
  const server = await createServer({ adapter: counted, port: 0, log: () => {} });
  try {
    for (const path of ["/api/task/panel", "/api/task/panel?id=", "/api/task/panel?id=--help", "/api/task/panel?id=TASK-1%20--json", "/api/task/panel?id=..%2FTASK-1"]) {
      const res = await call(server, path);
      assert.equal(res.status, 400, path);
      assert.equal(res.json.error.type, "bad-request", path);
    }
    assert.equal(spawns, 0, "no bad request reached the adapter");
    const res = await call(server, "/api/task/panel?id=TASK-1");
    assert.equal(res.status, 200);
    assert.equal(res.json.kind, "task-panel");
    assert.equal(res.json.id, "TASK-1");
    assert.equal(spawns, 5, "positive control: show, log, two queries and set --fields");
    assert.deepEqual(taskPanelModel(res.json).history.entries.map(e => e.source), ["seed", "take", "ask", "ask", "decide"]);
    // The plan view's show route lives on in the shared view module.
    const shown = await call(server, "/api/task?id=TASK-2");
    assert.equal(shown.status, 200);
    assert.equal(shown.json.kind, "task-show");
  } finally {
    await server.close();
  }
});

test("one view module registers the panel's routes, and the plan no longer has its own", () => {
  const owners = views.flatMap(v => v.routes.map(r => [`${r.method} ${r.path}`, v.id]));
  assert.deepEqual(owners.filter(([k]) => k.startsWith("GET /api/task?") || k === "GET /api/task" || k === "GET /api/task/panel"), [["GET /api/task", "task"], ["GET /api/task/panel", "task"]]);
  assert.match(read("src/views/index.mjs"), /import task from "\.\/task\.mjs";/);
  assert.doesNotMatch(read("src/web/plan.mjs"), /taskDetailModel|\/api\/task|showModal|popstate/);
});

test("the panel's page modules are served", async () => {
  const server = await createServer({ adapter, port: 0 });
  try {
    for (const path of ["/task.mjs", "/view-model/task.mjs"]) {
      const res = await call(server, path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers["content-type"], /^text\/javascript/, path);
    }
  } finally {
    await server.close();
  }
});

/* ---------- links from the views, and the URL ---------- */

test("the tasks, plan and decisions views link task ids to the panel", () => {
  // The panel is imported only after the vocabulary is read (UI-18), so its
  // first paint already uses branchling's colours; then it is started.
  const app = read("src/web/app.mjs");
  assert.match(app, /const panel = vocabularyRead\.then\(\(\) => import\("\/task\.mjs"\)\);/);
  assert.match(app, /panel\.then\(m => m\.start\(\)\);/);
  assert.match(read("src/web/tasks.mjs"), /"data-task": row\.id/);
  assert.match(read("src/web/plan.mjs"), /"data-task": task\.id/);
  assert.match(read("src/web/decisions.mjs"), /"data-task": q\.taskId/);
  assert.match(read("src/web/decisions.mjs"), /taskPanelHref\(location\.search, q\.taskId\)/);
});

test("the panel's address keeps the view and its parameters, and closing drops only task", () => {
  assert.equal(taskPanelHref("?view=tasks&status=pending", "TASK-3"), "?view=tasks&status=pending&task=TASK-3");
  assert.equal(taskPanelHref("?view=decisions&task=TASK-1", "TASK-2"), "?view=decisions&task=TASK-2");
  assert.equal(taskPanelHref("", "TASK-3"), "?task=TASK-3");
  assert.equal(taskPanelClosedHref("?view=plan&task=TASK-3"), "?view=plan");
  assert.equal(taskPanelClosedHref("?task=TASK-3"), "?");
  assert.equal(taskParam("?view=plan&task=TASK-3"), "TASK-3");
  assert.equal(taskParam("?view=plan"), null);
  assert.equal(taskParam("?task="), null);
});

test("the page opens on Escape-safe terms: a modal dialog, focus to its heading, Back closes it", () => {
  const page = read("src/web/task.mjs");
  assert.match(page, /showModal\(\)/);
  assert.match(page, /addEventListener\("cancel"/);
  assert.match(page, /title\.focus\(\)/);
  assert.match(page, /history\.pushState\(/);
  assert.match(page, /addEventListener\("popstate"/);
  assert.match(page, /returnFocus\(/);
});

/* ---------- the markdown subset, as plain data ---------- */

test("the markdown subset: headings, lists, fenced and inline code, paragraphs, links", () => {
  const blocks = markdownBlocks([
    "## Goal",
    "",
    "Round **once**, in `totals()`,",
    "see [the notes](https://example.com/notes).",
    "",
    "- first",
    "  - nested",
    "- second with `code`",
    "",
    "1. one",
    "2. two",
    "",
    "```js",
    "const x = 1 < 2;",
    "```",
    "### Done",
  ].join("\n"));
  assert.deepEqual(blocks.map(b => b.type), ["heading", "paragraph", "list", "list", "code", "heading"]);
  assert.deepEqual([blocks[0].level, blocks[5].level], [2, 3]);
  assert.deepEqual(blocks[1].inlines, [
    { type: "text", text: "Round **once**, in " },
    { type: "code", text: "totals()" },
    { type: "text", text: ", see " },
    { type: "link", text: "the notes", href: "https://example.com/notes" },
    { type: "text", text: "." },
  ]);
  assert.equal(blocks[2].ordered, false);
  assert.deepEqual(blocks[2].items.map(i => i.depth), [0, 1, 0]);
  assert.deepEqual(blocks[2].items[2].inlines.map(s => s.type), ["text", "code"]);
  assert.equal(blocks[3].ordered, true);
  assert.deepEqual(blocks[4], { type: "code", lang: "js", text: "const x = 1 < 2;" });
  assert.ok(isPlainData(blocks));
});

test("markup in a body is text: <script>, <img onerror> and HTML blocks are never elements", () => {
  const body = "<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n# <b>bold</b>\n\n- <a href=\"javascript:alert(3)\">x</a>";
  const blocks = markdownBlocks(body);
  assert.deepEqual(blocks.map(b => b.type), ["paragraph", "paragraph", "heading", "list"]);
  assert.deepEqual(blocks[0].inlines, [{ type: "text", text: "<script>alert(1)</script>" }]);
  assert.deepEqual(blocks[1].inlines, [{ type: "text", text: "<img src=x onerror=alert(2)>" }]);
  assert.deepEqual(blocks[2].inlines, [{ type: "text", text: "<b>bold</b>" }]);
  assert.deepEqual(blocks[3].items[0].inlines, [{ type: "text", text: "<a href=\"javascript:alert(3)\">x</a>" }]);
  // Every segment is text, code or a link with a safe href: nothing else exists to render.
  const segments = blocks.flatMap(b => b.inlines || b.items.flatMap(i => i.inlines));
  for (const s of segments) assert.ok(["text", "code", "link"].includes(s.type));
  assert.equal(segments.filter(s => s.type === "link").length, 0);
});

test("a link's href is http(s), relative or an anchor; javascript: and its disguises stay text", () => {
  for (const href of ["https://example.com/a?b=c#d", "http://example.com", "docs/architecture.md", "./x.md", "/abs", "#goal", "?view=plan"]) {
    assert.equal(safeHref(href), href, href);
  }
  for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)", " javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/passwd", "//evil.example", "\\\\evil.example", "/\\evil.example", "\u0001javascript:x", ""]) {
    assert.equal(safeHref(href), null, JSON.stringify(href));
  }
  assert.deepEqual(markdownInlines("[x](javascript:alert(1))").map(s => s.type), ["text"], "an unsafe link stays visible as text");
  assert.equal(markdownInlines("[x](javascript:alert(1))").map(s => s.text).join(""), "[x](javascript:alert(1))");
  assert.deepEqual(markdownInlines("[x](https://ok.example)"), [{ type: "link", text: "x", href: "https://ok.example" }]);
  // The page re-checks the href and sets rel on every link it builds.
  const page = read("src/web/task.mjs");
  assert.match(page, /seg\.type === "link" && safeHref\(seg\.href\)/);
  assert.match(page, /rel: "noopener noreferrer"/);
});

test("an unclosed fence runs to the end, and a code span keeps its markup as text", () => {
  assert.deepEqual(markdownBlocks("```\n<script>x</script>"), [{ type: "code", lang: null, text: "<script>x</script>" }]);
  assert.deepEqual(markdownInlines("`<b>` and ``a`b``"), [
    { type: "code", text: "<b>" }, { type: "text", text: " and " }, { type: "code", text: "a`b" },
  ]);
  assert.deepEqual(markdownInlines("a ` lone"), [{ type: "text", text: "a ` lone" }]);
});
