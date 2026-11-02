/**
 * The release view on the page: fetches /api/release, builds the shared view
 * model (src/view-model/release.mjs, served at /view-model/) and renders it
 * with DOM APIs into #release. Text goes in through textContent only.
 *
 * View state lives in the URL: `?target=<name>` and `?release=<name>` select
 * what is shown and pass through to `deploy status --target/--release`;
 * `?view=release` brings this section into view on load. A reload or a shared
 * link shows the same screen.
 */

import { releaseModel } from "/view-model/release.mjs";
import { fromApiError, loadingState, unreachableState } from "/view-model/states.mjs";

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

/** The selection, read from the URL. */
function selection() {
  const params = new URLSearchParams(location.search);
  return { target: params.get("target") || "", release: params.get("release") || "" };
}

/** Writes the selection into the URL; a change the Back button should undo. */
function select(next) {
  const params = new URLSearchParams(location.search);
  params.set("view", "release");
  for (const key of ["target", "release"]) {
    if (next[key]) params.set(key, next[key]);
    else params.delete(key);
  }
  history.pushState(null, "", `${location.pathname}?${params}`);
  load();
}

/** Target names seen so far, so a filtered answer can still offer the others. */
const knownTargets = new Set();

function renderState(model, retry) {
  const box = el("div", { class: `state state-${model.state}`, role: model.state === "loading" ? "status" : "alert" });
  if (model.state === "loading") {
    box.append(el("p", { text: "Loading the release pipeline…" }));
    return box;
  }
  box.append(el("h3", { text: model.title }), el("p", { text: model.detail }));
  if (model.refusalKind) box.append(el("p", { text: `Reason code: ${model.refusalKind}` }));
  const again = el("button", { type: "button", text: "Try again" });
  again.addEventListener("click", retry);
  box.append(again);
  return box;
}

/** The address of the current selection with one name replaced. */
function hrefWith(key, value) {
  const params = new URLSearchParams(location.search);
  params.set("view", "release");
  if (value) params.set(key, value);
  else params.delete(key);
  return `${location.pathname}?${params}`;
}

/**
 * A name the user typed that branchling rejected (UI-21): the state's title
 * and sentence, what is declared, a link per declared name, and branchling's
 * own message verbatim.
 */
function renderRejected(model) {
  const box = el("div", { class: "state state-rejected", role: "alert" });
  box.append(el("h3", { text: model.title }), el("p", { text: model.detail }));
  for (const name of model.names) {
    box.append(el("p", { text: name.declaredText }));
    if (name.declared && name.declared.length) {
      box.append(el("ul", { class: "rejected-choices", "aria-label": `Declared ${name.noun} names` }, name.declared.map(choice => {
        const link = el("a", { href: hrefWith(name.key, choice), text: choice });
        link.addEventListener("click", event => {
          event.preventDefault();
          select({ ...selection(), [name.key]: choice });
        });
        return el("li", {}, [link]);
      })));
    }
  }
  if (model.branchlingSaid) {
    box.append(el("p", { class: "bucket-note" }, [`${model.branchlingSaidLabel}: `, el("code", { text: model.branchlingSaid })]));
  }
  const clear = el("button", { type: "button", text: "Show without this name" });
  clear.addEventListener("click", () => {
    const next = selection();
    for (const name of model.names) next[name.key] = "";
    select(next);
  });
  box.append(clear);
  return box;
}

let form = null;

/** The selection form, built once so a reload of the data keeps its focus. */
function controls() {
  if (form) return form;
  form = el("form", { class: "release-controls", "aria-label": "Release pipeline selection" });
  const targetSelect = el("select", { id: "release-target", name: "target" });
  const releaseInput = el("input", { id: "release-name", name: "release", type: "text", autocomplete: "off", spellcheck: "false" });
  const show = el("button", { type: "submit", text: "Show" });
  const clear = el("button", { type: "button", text: "Clear" });
  clear.addEventListener("click", () => select({ target: "", release: "" }));
  form.addEventListener("submit", event => {
    event.preventDefault();
    select({ target: targetSelect.value, release: releaseInput.value.trim() });
  });
  form.append(
    el("label", { for: "release-target", text: "Target" }), targetSelect,
    el("label", { for: "release-name", text: "Compare with release" }), releaseInput,
    show, clear,
  );
  return form;
}

/** Puts the URL's selection and the targets seen so far into the form. */
function syncControls(current) {
  const targetSelect = form.querySelector("#release-target");
  const names = new Set(knownTargets);
  if (current.target) names.add(current.target);
  targetSelect.replaceChildren(el("option", { value: "", text: "All targets" }),
    ...[...names].sort().map(name => el("option", { value: name, text: name })));
  targetSelect.value = current.target;
  form.querySelector("#release-name").value = current.release;
}

function refsTable(model) {
  const rows = [el("tr", {}, [
    el("th", { scope: "row", text: "trunk" }),
    el("td", { text: model.trunk.spec }),
    el("td", { class: "sha", text: model.trunk.shaLabel }),
    el("td", { text: model.trunk.sourceText || "" }),
  ])];
  for (const ref of model.refs) {
    rows.push(el("tr", {}, [
      el("th", { scope: "row", text: ref.name }),
      el("td", { text: ref.ref && ref.ref !== ref.spec ? `${ref.spec} → ${ref.ref}` : ref.spec }),
      el("td", { class: ref.resolved ? "sha" : "sha unknown", text: ref.shaLabel }),
      el("td", { text: ref.recorded || "" }),
    ]));
  }
  return el("table", { class: "release-refs" }, [
    el("caption", { text: "Computed from these refs" }),
    el("thead", {}, [el("tr", {}, [
      el("th", { scope: "col", text: "Stage" }),
      el("th", { scope: "col", text: "Ref" }),
      el("th", { scope: "col", text: "SHA" }),
      el("th", { scope: "col", text: "Note" }),
    ])]),
    el("tbody", {}, rows),
  ]);
}

function taskItem(task) {
  const meta = [task.statusLabel + (task.closed ? ` ${task.closed}` : ""), task.waitedLabel];
  if (task.unknown) meta.push("unknown");
  return el("li", {}, [
    el("span", { class: "task-id", text: task.id }), " ",
    el("span", { text: task.title }), " ",
    el("span", { class: "task-meta", text: meta.join(" · ") }),
  ]);
}

function columnNode(column) {
  const parts = [
    el("h4", { text: column.label }),
    el("p", { class: column.unknown ? "bucket-count unknown" : "bucket-count", text: column.countLabel }),
  ];
  if (column.unknownDetail) parts.push(el("p", { class: "bucket-note", text: column.unknownDetail }));
  if (column.listedNote) parts.push(el("p", { class: "bucket-note", text: column.listedNote }));
  if (column.longestWaitLabel) parts.push(el("p", { class: "bucket-note", text: column.longestWaitLabel }));
  if (column.tasks.length) parts.push(el("ul", { class: "bucket-tasks" }, column.tasks.map(taskItem)));
  return el("li", { class: column.unknown ? "bucket bucket-unknown" : "bucket" }, parts);
}

function laneNode(lane) {
  const parts = [el("h3", { text: lane.target })];
  if (lane.note) parts.push(el("p", { class: "bucket-note", text: lane.note }));
  parts.push(el("ol", { class: "lane", "aria-label": `Stages of ${lane.target}` }, lane.columns.map(columnNode)));
  return el("section", { class: "release-lane" }, parts);
}

function releaseNode(rel) {
  const parts = [
    el("h3", { text: `Release ${rel.name}` }),
    el("p", { text: `${rel.planned} planned · ${rel.shipped} shipped (${rel.shippedNote}) · ${rel.dropped} dropped` }),
  ];
  if (rel.currentText) parts.push(el("p", { class: "bucket-note", text: rel.currentText }));
  if (rel.shippedAtText) parts.push(el("p", { class: rel.shippedAt && !rel.shippedAt.resolved ? "bucket-note unknown" : "bucket-note", text: rel.shippedAtText }));
  for (const sec of rel.sections) {
    parts.push(el("h4", {}, [
      sec.label + " ",
      el("span", { class: sec.unknown ? "bucket-count-inline unknown" : "bucket-count-inline", text: sec.countLabel }),
    ]));
    if (sec.tasks.length) {
      parts.push(el("ul", { class: "bucket-tasks" }, sec.tasks.map(task => el("li", {}, [
        el("span", { class: "task-id", text: task.id }), " ",
        el("span", { text: task.title }), " ",
        el("span", { class: "task-meta", text: [task.statusLabel, task.priority, ...task.details].filter(Boolean).join(" · ") }),
      ]))));
    }
  }
  return el("section", { class: "release-scope" }, parts);
}

function renderRelease(model) {
  const parts = [];
  if (model.freshness.stale) {
    parts.push(el("p", { class: "state state-stale", role: "status", text: "Showing the last known release pipeline; a fresh read is on its way." }));
  }
  if (model.state === "empty") {
    parts.push(el("div", { class: "state state-empty" }, [
      el("h3", { text: model.emptyState.title }),
      el("p", { text: model.emptyState.detail }),
    ]));
    if (model.release) parts.push(releaseNode(model.release));
    return parts;
  }
  parts.push(refsTable(model));
  if (model.release) parts.push(releaseNode(model.release));
  parts.push(...model.lanes.map(laneNode));
  if (model.unplaced.text) parts.push(el("p", { class: "bucket-note", text: model.unplaced.text }));
  return parts;
}

let generation = 0;
let body = null;

async function load() {
  const target = document.getElementById("release");
  if (!target) return;
  if (!body) {
    body = el("div", { "aria-live": "polite" });
    target.replaceChildren(controls(), body);
  }
  const current = selection();
  const mine = ++generation;
  syncControls(current);
  body.setAttribute("aria-busy", "true");
  body.replaceChildren(renderState(loadingState("release"), load));
  let model;
  try {
    const query = new URLSearchParams();
    if (current.target) query.set("target", current.target);
    if (current.release) query.set("release", current.release);
    const qs = query.toString();
    const res = await fetch(`/api/release${qs ? `?${qs}` : ""}`, { headers: { Accept: "application/json" } });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      model = fromApiError("release", json, res.status);
    } else {
      model = releaseModel(json, {
        stale: res.headers.get("x-branchling-ui-stale") === "1",
        fetchedAt: res.headers.get("x-branchling-ui-fetched-at"),
      });
    }
  } catch (err) {
    model = unreachableState("release", err.message);
  }
  if (mine !== generation) return;
  if (model.state === "ready" || model.state === "empty") {
    for (const lane of model.lanes) knownTargets.add(lane.target);
    syncControls(current);
    body.replaceChildren(...renderRelease(model));
  } else if (model.state === "rejected") {
    for (const name of model.names) if (name.key === "target" && name.declared) for (const t of name.declared) knownTargets.add(t);
    syncControls(current);
    body.replaceChildren(renderRejected(model));
  } else {
    body.replaceChildren(renderState(model, load));
  }
  body.setAttribute("aria-busy", "false");
}

window.addEventListener("popstate", load);
load().then(() => {
  if (new URLSearchParams(location.search).get("view") === "release") {
    document.getElementById("release-title")?.scrollIntoView();
  }
});
