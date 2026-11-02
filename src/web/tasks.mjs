/**
 * The tasks view on the page (UI-26), after docs/design/mockups/tasks.html:
 * fetches /api/tasks with the filters in the URL, builds the shared view model
 * (src/view-model/tasks.mjs, served at /view-model/) and renders it with DOM
 * APIs into #tasks. Text goes in through textContent only.
 *
 * View state is the URL: `?view=tasks&status=…&priority=…&task=<ID>`.
 *   - a filter applied (a field changed, the form submitted, Clear) is
 *     `history.pushState`, so Back undoes it;
 *   - typing in the search box is `history.replaceState`, debounced, so Back
 *     does not step through every keystroke;
 *   - `popstate` re-reads the URL, puts it into the form and loads again.
 * The `/` key focuses the search box unless focus is already in a text field.
 *
 * A row's id and title link to `?view=tasks&…&task=<ID>`, the task panel's
 * address; until the panel exists (the next task of this wave) the row is
 * marked selected and its id is named above the list.
 *
 * Below 640 px the table folds into a list (CSS only: the `.hide-sm` table and
 * the `.show-sm` list carry the same rows).
 */

import {
  TASK_FILTER_KEYS, TASK_FILTER_LABELS, TASKS_TEXT,
  filtersSummaryText, parseTaskFilters, parseTaskSelection, tasksFailure, tasksHref, tasksLoading, tasksModel, writeTaskFilters,
} from "/view-model/tasks.mjs";
import { unreachableState } from "/view-model/states.mjs";

const SEARCH_DEBOUNCE_MS = 300;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

/** An icon from the sprite; decorative, so hidden from assistive technology. */
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `/icons.svg#${name}`);
  svg.append(use);
  return svg;
}

let root;            // #tasks
let form;            // the filter form, built once so focus survives a reload of the data
let countRegion;     // aria-live: the result count
let results;         // the list, or the state
let stats = null;    // a stats envelope, for the values offered; optional
let lastAnswer = null;
let loadSeq = 0;
let searchTimer = null;

const filtersFromUrl = () => parseTaskFilters(new URLSearchParams(location.search));
const selectionFromUrl = () => parseTaskSelection(new URLSearchParams(location.search));

/** Writes filters (and no task) into the URL. */
function navigate(filters, { replace = false } = {}) {
  const href = location.pathname + tasksHref(filters);
  if (href === location.pathname + location.search) return false;
  if (replace) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  return true;
}

function formFilters() {
  const filters = {};
  for (const key of TASK_FILTER_KEYS) {
    const value = form.elements[key].value.trim();
    if (value) filters[key] = value;
  }
  return filters;
}

function apply() {
  clearTimeout(searchTimer);
  if (navigate(formFilters())) load();
}

function buildForm() {
  form = el("form", { class: "tasks-controls", role: "search", "aria-label": "Filter tasks", novalidate: "" });
  const search = el("div", { class: "field tasks-search" }, [
    el("label", { for: "tasks-text", text: `Filter by ${TASK_FILTER_LABELS.text.toLowerCase()}` }),
    el("div", { class: "search" }, [
      icon("search"),
      el("input", { id: "tasks-text", name: "text", class: "input input-search", type: "search", autocomplete: "off", spellcheck: "false", "aria-keyshortcuts": "/", "aria-describedby": "tasks-search-hint" }),
    ]),
    el("span", { id: "tasks-search-hint", class: "hint" }, ["Press ", el("kbd", { text: "/" }), " to jump here."]),
  ]);
  const fields = TASK_FILTER_KEYS.filter(k => k !== "text").map(key => el("div", { class: "field" }, [
    el("label", { for: `tasks-${key}`, text: TASK_FILTER_LABELS[key] }),
    el("input", { id: `tasks-${key}`, name: key, class: "input", type: "text", list: `tasks-${key}-values`, autocomplete: "off", spellcheck: "false" }),
    el("datalist", { id: `tasks-${key}-values` }),
  ]));
  const actions = el("div", { class: "tasks-actions" }, [
    el("button", { type: "submit", class: "btn btn-primary btn-sm", text: "Apply" }),
    el("button", { type: "button", class: "btn btn-secondary btn-sm", "data-action": "clear", text: "Clear filters" }),
  ]);
  // The field filters fold away on a phone so the list starts in the first
  // viewport; the search box stays visible. The summary says how many are
  // set, so a folded list still reads as filtered.
  const details = el("details", { class: "task-filters" }, [
    el("summary", { class: "task-filters-summary" }, [icon("chevron-right"), el("span", { class: "task-filters-label", text: TASKS_TEXT.filtersSummary(0) })]),
    el("div", { class: "task-filters-body" }, [el("div", { class: "tasks-fields" }, fields), actions]),
  ]);
  form.append(search, details);
  // Open from 640 px up, closed below; a toggle by the user holds until the
  // breakpoint is crossed.
  const wide = window.matchMedia("(min-width: 640px)");
  details.open = wide.matches;
  wide.addEventListener("change", event => { details.open = event.matches; });
  form.addEventListener("submit", event => {
    event.preventDefault();
    apply();
  });
  // A field left with a new value applies it; Back then undoes it.
  form.addEventListener("change", event => {
    if (event.target.name && event.target.name !== "text") apply();
  });
  form.elements.text.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (navigate(formFilters(), { replace: true })) load();
    }, SEARCH_DEBOUNCE_MS);
  });
  form.querySelector('[data-action="clear"]').addEventListener("click", () => {
    for (const key of TASK_FILTER_KEYS) form.elements[key].value = "";
    apply();
    form.elements.text.focus();
  });
  return form;
}

/** Puts the URL's filters into the form, without stealing focus. */
function syncForm(filters) {
  form.querySelector(".task-filters-label").textContent = filtersSummaryText(filters);
  for (const key of TASK_FILTER_KEYS) {
    const input = form.elements[key];
    if (input.value.trim() !== (filters[key] || "")) input.value = filters[key] || "";
  }
}

/** The values offered per filter, from the answers (UI-18 brings the vocabulary). */
function syncOptions(options) {
  for (const key of TASK_FILTER_KEYS) {
    const list = form.querySelector(`#tasks-${key}-values`);
    if (!list) continue;
    list.replaceChildren(...(options[key] || []).map(value => el("option", { value })));
  }
}

function renderState(model) {
  const box = el("div", { class: `state state-${model.state}`, role: model.state === "loading" ? "status" : "alert" });
  if (model.state === "loading") {
    box.append(el("p", { text: TASKS_TEXT.loading }));
    return box;
  }
  box.append(el("h3", { text: model.title }), el("p", { class: "detail", text: model.detail }));
  if (model.state === "rejected") {
    for (const name of model.names) box.append(el("p", { text: name.declaredText }));
    if (model.branchlingSaid) box.append(el("p", { class: "bucket-note" }, [`${model.branchlingSaidLabel}: `, el("code", { text: model.branchlingSaid })]));
    const clear = el("button", { type: "button", text: "Show without this name" });
    clear.addEventListener("click", () => {
      const next = filtersFromUrl();
      for (const name of model.names) delete next[name.key];
      navigate(next);
      syncForm(next);
      load();
    });
    box.append(clear);
    return box;
  }
  if (model.refusalKind) box.append(el("p", { text: `Reason code: ${model.refusalKind}` }));
  const again = el("button", { type: "button", text: "Try again" });
  again.addEventListener("click", () => load());
  box.append(again);
  return box;
}

/** A link that opens a task over the list: same document, so pushState. */
function taskLink(row, className, text) {
  const link = el("a", { class: className, href: row.href, text });
  if (row.selected) link.setAttribute("aria-current", "true");
  link.addEventListener("click", event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    history.pushState(null, "", row.href);
    render();
  });
  return link;
}

function table(model) {
  const head = ["Id", "Title", "Status", "Priority", "Owner", "Board"].map(h => el("th", { scope: "col", text: h }));
  const body = model.rows.map(row => el("tr", row.selected ? { "aria-selected": "true" } : {}, [
    el("th", { scope: "row" }, [taskLink(row, "task-id", row.id)]),
    el("td", { class: "title-cell" }, [
      taskLink(row, "task-link", row.title),
      ...(row.meta ? [el("div", { class: "t-meta", text: row.meta })] : []),
    ]),
    el("td", {}, [el("span", { class: `badge role-${row.statusRole}`, text: row.statusLabel })]),
    el("td", {}, [el("span", { class: `prio role-${row.priorityRole}`, text: row.priorityLabel })]),
    el("td", { text: row.ownerLabel }),
    el("td", { text: row.boardLabel }),
  ]));
  return el("div", { class: "table-wrap hide-sm" }, [
    el("table", { class: "table tasks-table" }, [
      el("caption", { class: "visually-hidden", text: model.caption }),
      el("thead", {}, [el("tr", {}, head)]),
      el("tbody", {}, body),
    ]),
  ]);
}

/** The phone list: the same rows, the columns folded into one meta line. */
function list(model) {
  const items = model.rows.map(row => el("li", row.selected ? { class: "selected" } : {}, [
    taskLink(row, "task-id", row.id),
    taskLink(row, "task-link", row.title),
    el("span", { class: `prio role-${row.priorityRole}`, "aria-label": `Priority ${row.priorityLabel}`, text: row.priorityLabel }),
    el("span", { class: "meta" }, [
      el("span", { class: `badge role-${row.statusRole}`, text: row.statusLabel }),
      ...(row.owner ? [el("span", { class: "t-meta", text: row.owner })] : []),
      ...(row.meta ? [el("span", { class: "t-meta", text: row.meta })] : []),
    ]),
  ]));
  return el("div", { class: "card show-sm" }, [el("ul", { class: "tlist", "aria-label": model.caption }, items)]);
}

function renderModel(model) {
  const parts = [];
  if (model.freshness.stale) parts.push(el("p", { class: "state state-stale", role: "status", text: TASKS_TEXT.stale }));
  if (model.selection) {
    const close = el("a", { class: "panel-close", href: model.selection.closeHref, text: "Close" });
    close.addEventListener("click", event => {
      event.preventDefault();
      history.pushState(null, "", model.selection.closeHref);
      render();
    });
    parts.push(el("div", { class: "tasks-selection", role: "status" }, [
      el("p", {}, [el("span", { class: "task-id", text: model.selection.id }), " ", model.selection.text]),
      close,
    ]));
  }
  if (model.state === "empty") {
    const box = el("div", { class: "state state-empty" }, [el("p", { text: model.emptyText })]);
    if (model.emptyHint) box.append(el("p", { text: model.emptyHint }));
    if (model.filtered) {
      const clear = el("a", { href: model.clearHref, class: "btn btn-secondary btn-sm", text: "Clear filters" });
      clear.addEventListener("click", event => {
        event.preventDefault();
        syncForm({});
        navigate({});
        load();
      });
      box.append(clear);
    }
    parts.push(box);
    return parts;
  }
  parts.push(table(model), list(model));
  return parts;
}

/** Renders the last answer for the current URL's selection, without fetching. */
function render() {
  if (!lastAnswer) return;
  const model = tasksModel(lastAnswer.body, lastAnswer.filters, lastAnswer.freshness, { stats, task: selectionFromUrl() });
  syncOptions(model.options);
  root.querySelector(".tasks-scope").textContent = model.scope.text;
  countRegion.textContent = model.count.text;
  results.replaceChildren(...renderModel(model));
}

async function load() {
  const seq = ++loadSeq;
  const filters = filtersFromUrl();
  form.querySelector(".task-filters-label").textContent = filtersSummaryText(filters);
  results.setAttribute("aria-busy", "true");
  if (!lastAnswer) results.replaceChildren(renderState(tasksLoading()));
  let failure = null;
  let answer = null;
  try {
    const query = writeTaskFilters(filters);
    const res = await fetch("/api/tasks" + (query ? "?" + query : ""), { headers: { Accept: "application/json" } });
    const body = await res.json().catch(() => null);
    if (!res.ok) failure = tasksFailure(body, res.status);
    else {
      answer = {
        body,
        filters,
        freshness: { stale: res.headers.get("x-branchling-ui-stale") === "1", fetchedAt: res.headers.get("x-branchling-ui-fetched-at") },
      };
    }
  } catch (err) {
    failure = unreachableState("tasks", err.message);
  }
  if (seq !== loadSeq) return; // a newer filter is on its way
  results.setAttribute("aria-busy", "false");
  if (failure) {
    lastAnswer = null;
    countRegion.textContent = "";
    results.replaceChildren(renderState(failure));
    return;
  }
  lastAnswer = answer;
  render();
}

/** The keys of `stats --json`, for the values each filter offers. Optional. */
async function loadStats() {
  try {
    const res = await fetch("/api/stats", { headers: { Accept: "application/json" } });
    if (!res.ok) return;
    stats = await res.json();
    render();
  } catch {
    // The values offered then come from the list alone.
  }
}

function isTextField(node) {
  if (!node) return false;
  if (node.isContentEditable) return true;
  if (node.tagName === "TEXTAREA" || node.tagName === "SELECT") return true;
  return node.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "reset"].includes(node.type);
}

export function start(section) {
  root = section.querySelector("#tasks");
  countRegion = el("p", { class: "tasks-count", "aria-live": "polite", "aria-atomic": "true" });
  results = el("div", { class: "tasks-results" });
  root.replaceChildren(
    buildForm(),
    el("div", { class: "tasks-summary" }, [el("p", { class: "tasks-scope quiet" }), countRegion]),
    results,
  );
  syncForm(filtersFromUrl());

  document.addEventListener("keydown", event => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || isTextField(document.activeElement)) return;
    event.preventDefault();
    form.elements.text.focus();
    form.elements.text.select();
  });
  window.addEventListener("popstate", () => {
    clearTimeout(searchTimer);
    syncForm(filtersFromUrl());
    load();
  });

  load();
  loadStats();
}
