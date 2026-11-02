/**
 * The task panel (UI-27), after docs/design/mockups/task.html: everything
 * about one task, opened over whatever view is on screen at `?task=<ID>`.
 *
 * app.mjs starts it on every page. Any link carrying `data-task="<ID>"` (the
 * tasks list, the plan, the decisions view, and the blockers inside the panel
 * itself) opens it in place; the link's own href is the address, so a reload,
 * a new tab or a shared link show the same thing, and work without this
 * script.
 *
 * THE URL AND BACK. Opening pushes an entry whose state counts how many
 * panel entries deep it is (`{ taskPanel: n }`), so Back closes the panel (or
 * goes back to the task before, after following a blocker). Close and Escape
 * go back that many entries, so a closed panel is not reopened by Back; a
 * panel that came with the page (a pasted link) is closed by removing `task`
 * from the URL in place.
 *
 * FOCUS. The panel is a modal `<dialog>`: focus moves to its heading, the
 * view behind is inert while it is open, Escape closes it, and focus returns
 * to the link that opened it. A view that redraws while the panel is open
 * (the tasks list marks the open row) replaces that link, so it is found
 * again by its task id. Text goes in through textContent only; the body's
 * markdown arrives as plain blocks from the view model and is built as DOM
 * nodes, never parsed as HTML.
 *
 * Every change of the open task is announced to the views as a
 * `branchling-ui:task-panel` event on document.
 */

import {
  TASK_ID_SHAPE, TASK_TEXT,
  safeHref, taskNotFound, taskPanelClosedHref, taskPanelFailure, taskPanelLoading, taskPanelModel, taskParam,
} from "/view-model/task.mjs";
import { fromApiError, unreachableState } from "/view-model/states.mjs";

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
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

function when(ts) {
  if (!ts) return null;
  const at = new Date(ts);
  return el("time", { datetime: ts, text: Number.isNaN(at.getTime()) ? ts : at.toLocaleString() });
}

let dialog;
let idNode;
let title;
let tags;
let body;
let shownId = null;   // the task the panel shows, null when closed
let request = 0;      // the newest read; an older answer is dropped
let opener = null;    // { node, id, cls } of the link that opened the panel
let stripOnPop = false;

const depthNow = () => (history.state && Number.isInteger(history.state.taskPanel) ? history.state.taskPanel : 0);
const notify = () => document.dispatchEvent(new Event("branchling-ui:task-panel"));
const visible = node => node.isConnected && node.getClientRects().length > 0;

function build() {
  idNode = el("span", { class: "task-id" });
  const close = el("button", { type: "button", class: "btn btn-ghost btn-icon btn-sm task-panel-close", "aria-label": TASK_TEXT.close }, [icon("x")]);
  close.addEventListener("click", () => requestClose());
  title = el("h2", { id: "task-panel-title", class: "task-panel-title", tabindex: "-1" });
  tags = el("div", { class: "task-panel-tags" });
  body = el("div", { class: "task-panel-body", "aria-live": "polite" });
  dialog = el("dialog", { class: "task-panel", "aria-labelledby": "task-panel-title" }, [
    el("div", { class: "task-panel-frame" }, [
      el("header", { class: "task-panel-head" }, [el("div", { class: "task-panel-bar" }, [idNode, close]), title, tags]),
      body,
    ]),
  ]);
  // Escape: closed through the URL like the Close button, so Back stays right.
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    requestClose();
  });
  // A browser may close a modal dialog itself (a second Escape); follow it.
  dialog.addEventListener("close", () => { if (shownId !== null) requestClose(); });
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener("click", event => { if (event.target === dialog) requestClose(); });
  document.body.append(dialog);
}

/* ---------- rendering ---------- */

function setHead(id, text, tagNodes = []) {
  idNode.textContent = id;
  title.textContent = text;
  tags.replaceChildren(...tagNodes);
}

function stateBox(model, retry) {
  if (model.state === "loading") return el("p", { class: "state state-loading", role: "status", text: model.text });
  if (model.state === "not-found") {
    const box = el("div", { class: "state task-panel-not-found", role: "status" }, [el("p", { text: model.detail })]);
    if (model.branchlingSaid) box.append(el("p", { class: "t-meta" }, [`${model.branchlingSaidLabel}: `, el("code", { text: model.branchlingSaid })]));
    return box;
  }
  const box = el("div", { class: `state state-${model.state}`, role: "alert" }, [
    el("h3", { text: model.title }),
    el("p", { class: "detail", text: model.detail }),
  ]);
  if (model.refusalKind) box.append(el("p", { text: `Reason code: ${model.refusalKind}` }));
  if (retry) {
    const again = el("button", { type: "button", class: "btn btn-secondary btn-sm", text: "Try again" });
    again.addEventListener("click", retry);
    box.append(again);
  }
  return box;
}

function section(id, heading, children, aside = null) {
  return el("section", { class: "task-panel-section", "aria-labelledby": id }, [
    el("div", { class: "section-head" }, [el("h3", { id, class: "t-title", text: heading }), aside]),
    ...children,
  ]);
}

function fieldValue(field) {
  if (field.kind === "status") return el("span", { class: `badge role-${field.role}`, text: field.display });
  if (field.kind === "priority") return el("span", { class: `prio role-${field.role}`, text: field.display });
  if (field.kind === "list" && field.items.length) return el("span", { class: "task-panel-items" }, field.items.map(v => el("span", { class: "badge plain role-neutral", text: v })));
  if (field.value === null || (Array.isArray(field.value) && !field.value.length)) return el("span", { class: "task-panel-none", text: field.display });
  return document.createTextNode(field.display);
}

function taskRows(rows, emptyText) {
  if (!rows.length) return el("p", { class: "task-panel-note", text: emptyText });
  return el("ul", { class: "tasks" }, rows.map(r => el("li", { class: "task" }, [
    el("a", { class: "task-id", href: r.href, "data-task": r.id, text: r.id }),
    r.title ? el("span", { class: "task-title", text: r.title }) : null,
    r.statusLabel ? el("span", { class: `badge role-${r.role}`, text: r.statusLabel }) : null,
    r.note ? el("span", { class: "task-notes", text: r.note }) : null,
  ])));
}

function inlineNodes(inlines) {
  return inlines.map(seg => {
    if (seg.type === "code") return el("code", { text: seg.text });
    // The model only emits safe hrefs; checked again here all the same.
    if (seg.type === "link" && safeHref(seg.href)) return el("a", { href: seg.href, rel: "noopener noreferrer", text: seg.text });
    return document.createTextNode(seg.text);
  });
}

/** One markdown block (plain data from the model) as DOM nodes. */
function blockNode(block) {
  if (block.type === "heading") return el(`h${Math.min(6, block.level + 3)}`, {}, inlineNodes(block.inlines));
  if (block.type === "list") {
    return el(block.ordered ? "ol" : "ul", {}, block.items.map(item => el("li", { class: `md-depth-${item.depth}` }, inlineNodes(item.inlines))));
  }
  if (block.type === "code") return el("pre", {}, [el("code", { text: block.text })]);
  return el("p", {}, inlineNodes(block.inlines || []));
}

function historyItem(entry) {
  const mark = { question: "decision", decision: "check", change: "pen", event: "doc" }[entry.kind] || "doc";
  const parts = [
    el("p", { class: "what" }, [el("strong", { text: entry.actor }), ` · ${entry.source}`]),
    entry.ts ? el("p", { class: "t-meta" }, [when(entry.ts)]) : null,
  ];
  const lines = [...entry.events, ...entry.messages.map(m => m.display), ...entry.changes.map(c => c.text)];
  if (lines.length) parts.push(el("ul", { class: "task-panel-changes" }, lines.map(line => el("li", { text: line }))));
  if (entry.reason) parts.push(el("p", { class: "reason", text: entry.reason }));
  return el("li", {}, [el("span", { class: "mark" }, [icon(mark)]), el("div", {}, parts)]);
}

function renderReady(model) {
  setHead(model.id, model.title, [
    el("span", { class: `badge role-${model.statusRole}`, text: model.statusLabel }),
    el("span", { class: `prio role-${model.priorityRole}`, text: model.priorityLabel }),
    model.meta ? el("span", { class: "t-meta", text: model.meta }) : null,
  ].filter(Boolean));
  const parts = [];
  if (model.freshness.stale) parts.push(el("p", { class: "state state-stale", role: "status", text: TASK_TEXT.stale }));
  if (model.freshness.fetchedAt) parts.push(el("p", { class: "t-meta" }, [`${TASK_TEXT.asOf} `, when(model.freshness.fetchedAt)]));

  const fields = [el("dl", { class: "kv" }, model.fields.flatMap(f => [el("dt", { text: f.label }), el("dd", {}, [fieldValue(f)])]))];
  if (!model.fieldsKnown) fields.push(el("p", { class: "task-panel-note", text: TASK_TEXT.fieldsUnknown }));
  parts.push(section("task-panel-fields", TASK_TEXT.fields, fields));

  parts.push(section("task-panel-blockers", TASK_TEXT.blockers, [
    el("h4", { text: TASK_TEXT.blockedBy }),
    taskRows(model.blockers.blockedBy, model.blockers.blockedByEmpty),
    el("h4", { text: TASK_TEXT.blocks }),
    taskRows(model.blockers.blocks, model.blockers.blocksEmpty),
    el("p", { class: "task-panel-note", text: model.blockers.blocksScope }),
  ]));

  const computed = [el("p", { text: model.computed.blockedText })];
  if (model.computed.elsewhereText) computed.push(el("p", { text: model.computed.elsewhereText }));
  if (model.computed.file) computed.push(el("p", { class: "task-panel-file" }, [el("code", { text: model.computed.file })]));
  parts.push(section("task-panel-computed", TASK_TEXT.computed, computed, el("span", { class: "t-meta" }, [el("code", { text: "show" })])));

  const md = model.body.known && model.body.blocks.length
    ? [el("div", { class: "task-panel-md" }, model.body.blocks.map(blockNode))]
    : [el("p", { class: "task-panel-note", text: model.body.text })];
  parts.push(section("task-panel-body", TASK_TEXT.body, md));

  const history = model.history.count
    ? [el("p", { class: "task-panel-note", text: model.history.note }), el("ol", { class: "timeline" }, model.history.entries.map(historyItem))]
    : [el("p", { class: "task-panel-note", text: model.history.emptyText })];
  parts.push(section("task-panel-history", TASK_TEXT.history, history, el("span", { class: "badge plain role-neutral", text: String(model.history.count) })));
  body.replaceChildren(...parts);
}

function render(model, retry) {
  if (model.state === "ready") { renderReady(model); return; }
  if (model.state === "not-found") setHead(model.id, model.title);
  else if (model.state === "loading") setHead(model.id, model.id);
  else setHead(model.id, TASK_TEXT.panelLabel);
  body.replaceChildren(stateBox(model, retry));
}

/* ---------- opening and closing ---------- */

async function show(id, { reload = false } = {}) {
  if (!dialog.open) dialog.showModal();
  if (id === shownId && !reload) { title.focus(); return; }
  shownId = id;
  const mine = ++request;
  if (!TASK_ID_SHAPE.test(id)) {
    render(taskNotFound(id));
    title.focus();
    return;
  }
  body.setAttribute("aria-busy", "true");
  render(taskPanelLoading(id));
  title.focus();
  let model;
  try {
    const res = await fetch(`/api/task/panel?id=${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } });
    const json = await res.json().catch(() => null);
    if (!res.ok) model = taskPanelFailure(id, json, res.status);
    else {
      try {
        model = taskPanelModel(json, {
          stale: res.headers.get("x-branchling-ui-stale") === "1",
          fetchedAt: res.headers.get("x-branchling-ui-fetched-at"),
        }, location.search);
      } catch (err) {
        model = { ...fromApiError("task", { error: { type: "contract-mismatch", message: err.message } }), id };
      }
    }
  } catch (err) {
    model = { ...unreachableState("task", err.message), id };
  }
  if (mine !== request) return;
  render(model, () => show(id, { reload: true }));
  body.setAttribute("aria-busy", "false");
}

function returnFocus(target) {
  let node = target && target.node;
  if (target && (!node || !visible(node))) {
    const candidates = [...document.querySelectorAll(`#main a[data-task="${CSS.escape(target.id)}"]`)].filter(visible);
    node = candidates.find(n => n.className === target.cls) || candidates[0] || null;
  }
  (node || document.getElementById("main"))?.focus();
}

function hide() {
  if (shownId === null && !dialog.open) return;
  const target = opener || (shownId ? { node: null, id: shownId, cls: "task-id" } : null);
  request++;
  shownId = null;
  opener = null;
  if (dialog.open) dialog.close();
  body.replaceChildren();
  // After the views have redrawn for the closed panel (popstate, the event).
  setTimeout(() => returnFocus(target), 0);
}

/** Close, Escape, the backdrop: back out of the panel's own history entries. */
function requestClose() {
  const depth = depthNow();
  if (depth > 0) {
    stripOnPop = true;
    history.go(-depth);
    return;
  }
  history.replaceState(history.state, "", location.pathname + taskPanelClosedHref(location.search) + location.hash);
  hide();
  notify();
}

function onPopState() {
  const id = taskParam(location.search);
  if (id && stripOnPop) {
    // Backed out to the entry the page loaded with, which named a task.
    history.replaceState(history.state, "", location.pathname + taskPanelClosedHref(location.search) + location.hash);
    stripOnPop = false;
    hide();
    return;
  }
  stripOnPop = false;
  if (id) show(id);
  else hide();
}

function onClick(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest("a[data-task]") : null;
  if (!link) return;
  const id = link.dataset.task;
  const href = link.getAttribute("href");
  if (!id || !href) return;
  event.preventDefault();
  const open = dialog.open;
  if (!open) opener = { node: link, id, cls: link.className };
  history.pushState({ ...(history.state || {}), taskPanel: (open ? depthNow() : 0) + 1 }, "", href);
  show(id);
  notify();
}

/** Called by app.mjs on every page. */
export function start() {
  if (dialog) return;
  build();
  document.addEventListener("click", onClick);
  window.addEventListener("popstate", onPopState);
  const id = taskParam(location.search);
  if (id) show(id);
}
