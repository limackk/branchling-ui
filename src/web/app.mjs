/**
 * The page. It fetches envelopes from the local API, turns them into the
 * shared view model (served from /view-model/, the same modules the terminal
 * interface imports) and renders that model with DOM APIs. Text goes in
 * through textContent only: the model is data, never markup.
 */

import { STATS_TEXT, statsModel } from "/view-model/stats.mjs";
import { fromApiError, loadingState, unreachableState } from "/view-model/states.mjs";

/** The capability every write sends (UI-5, UI-6). Reads do not need it. */
export const capability = document.querySelector('meta[name="branchling-ui-capability"]')?.content || "";

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

function renderState(model, retry) {
  const box = el("div", { class: `state state-${model.state}`, role: model.state === "loading" ? "status" : "alert" });
  if (model.state === "loading") {
    box.append(el("p", { text: STATS_TEXT.loading }));
    return box;
  }
  box.append(el("h3", { text: model.title }), el("p", { class: "detail", text: model.detail }));
  if (model.refusalKind) box.append(el("p", { text: `Reason code: ${model.refusalKind}` }));
  const again = el("button", { type: "button", text: "Try again" });
  again.addEventListener("click", retry);
  box.append(again);
  return box;
}

function countTable(caption, rows) {
  const body = rows.map(row => el("tr", {}, [
    el("th", { scope: "row" }, [el("span", { class: `role role-${row.role}`, text: row.label })]),
    el("td", { class: "num", text: String(row.count) }),
  ]));
  return el("table", {}, [
    el("caption", { class: "visually-hidden", text: caption }),
    el("thead", {}, [el("tr", {}, [el("th", { scope: "col", text: "Value" }), el("th", { scope: "col", text: STATS_TEXT.countHeading })])]),
    el("tbody", {}, body),
  ]);
}

function renderStats(model) {
  const parts = [];
  if (model.freshness.stale) {
    parts.push(el("p", { class: "state state-stale", role: "status", text: STATS_TEXT.stale }));
  }
  parts.push(el("dl", { class: "totals" }, model.totals.map(t =>
    el("div", {}, [el("dt", { text: t.label }), el("dd", { text: String(t.value) })]))));
  if (model.state === "empty") {
    parts.push(el("p", { class: "state state-empty", text: STATS_TEXT.empty }));
    return parts;
  }
  parts.push(el("h3", { text: STATS_TEXT.byStatus }), countTable("Tasks by status", model.byStatus));
  if (model.byPriority.length) parts.push(el("h3", { text: STATS_TEXT.byPriority }), countTable("Tasks by priority", model.byPriority));
  return parts;
}

async function load() {
  const target = document.getElementById("stats");
  target.setAttribute("aria-busy", "true");
  target.replaceChildren(renderState(loadingState("stats"), load));
  let model;
  try {
    const res = await fetch("/api/stats", { headers: { Accept: "application/json" } });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      model = fromApiError("stats", body, res.status);
    } else {
      // A cache hit is fresh (see docs/architecture.md); stale is for a
      // remembered answer served while a fresh read is on its way.
      model = statsModel(body, {
        stale: res.headers.get("x-branchling-ui-stale") === "1",
        fetchedAt: res.headers.get("x-branchling-ui-fetched-at"),
      });
    }
  } catch (err) {
    model = unreachableState("stats", err.message);
  }
  if (model.root) document.getElementById("root").textContent = model.root;
  target.replaceChildren(...(model.state === "ready" || model.state === "empty" ? renderStats(model) : [renderState(model, load)]));
  target.setAttribute("aria-busy", "false");
}

/*
 * Which view is on screen is `?view=` in the URL. Stats is rendered here; any
 * other view is its own module in src/web/, listed below with ONE line, and is
 * imported only when it is on screen. It exports `start(section)`, or starts
 * itself on import as release.mjs does. No `view`, or one not listed, is the
 * overview (UI-29); `?view=stats` still shows the stats view, which the
 * overview folds in and the nav no longer links (docs/architecture.md).
 */
const VIEW_MODULES = {
  decisions: "/decisions.mjs",
  health: "/health.mjs",
  overview: "/overview.mjs",
  plan: "/plan.mjs",
  release: "/release.mjs",
  tasks: "/tasks.mjs",
};

const requested = new URLSearchParams(location.search).get("view");
const current = requested === "stats" || Object.hasOwn(VIEW_MODULES, requested) ? requested : "overview";
for (const section of document.querySelectorAll("[data-view]")) section.hidden = section.dataset.view !== current;
for (const link of document.querySelectorAll("[data-view-link]")) {
  if (link.dataset.viewLink === current) link.setAttribute("aria-current", "page");
  else link.removeAttribute("aria-current");
}
if (current === "stats") load();
else import(VIEW_MODULES[current]).then(m => m.start?.(document.querySelector(`[data-view="${current}"]`)));

// The task panel (UI-27) opens over every view: `?task=<ID>`, or any link
// carrying `data-task`. Its own module, so no view repeats it.
import("/task.mjs").then(m => m.start());
