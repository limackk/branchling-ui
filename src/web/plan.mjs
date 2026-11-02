/**
 * The plan view on the page (`?view=plan`, `&task=<ID>` for the open detail
 * panel). It fetches `/api/plan` and `/api/plan/tasks` once, builds the shared
 * model (src/view-model/plan.mjs) and renders it with DOM APIs; text goes in
 * through textContent only. The task detail panel fetches `/api/task?id=` for
 * the one task the user opened.
 *
 * Order on screen follows the questions the plan answers, in the order they
 * are asked: where are we (the summary), what is happening (in flight), what
 * is next (may start now), the waves themselves (finished ones collapsed),
 * what the plan has been overtaken by, and how much is outside it.
 */

import { planModel, taskDetailModel } from "/view-model/plan.mjs";
import { fromApiError, loadingState, unreachableState } from "/view-model/states.mjs";

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

const SVG = "http://www.w3.org/2000/svg";

/** An icon from the design system's sprite (/icons.svg), hidden from assistive technology. */
function icon(name, cls = "icon") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `/icons.svg#${name}`);
  svg.append(use);
  return svg;
}

function taskHref(id) {
  const params = new URLSearchParams(location.search);
  params.set("view", "plan");
  params.set("task", id);
  return "?" + params.toString();
}

function closedHref() {
  const params = new URLSearchParams(location.search);
  params.delete("task");
  return "?" + params.toString();
}

async function getJson(path) {
  try {
    const res = await fetch(path, { headers: { Accept: "application/json" } });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body, fetchedAt: res.headers.get("x-branchling-ui-fetched-at"), stale: res.headers.get("x-branchling-ui-stale") === "1" };
  } catch (err) {
    return { ok: false, unreachable: true, message: err.message };
  }
}

function failureModel(view, answer) {
  return answer.unreachable ? unreachableState(view, answer.message) : fromApiError(view, answer.body, answer.status);
}

/** An answer the model cannot read is the installed branchling's shape, not a fault here. */
function shapeError(view, err) {
  return fromApiError(view, { error: { type: "contract-mismatch", message: err.message } });
}

function renderState(model, retry, what) {
  const box = el("div", { class: `state state-${model.state}`, role: model.state === "loading" ? "status" : "alert" });
  if (model.state === "loading") {
    box.append(el("p", { text: `Loading ${what}…` }));
    return box;
  }
  box.append(el("h3", { text: model.title }), el("p", { class: "detail", text: model.detail }));
  if (model.refusalKind) box.append(el("p", { text: `Reason code: ${model.refusalKind}` }));
  if (retry) {
    const again = el("button", { type: "button", text: "Try again" });
    again.addEventListener("click", retry);
    box.append(again);
  }
  return box;
}

/* ---------- the plan ---------- */

function edgeText(edge) {
  if (edge.open === true) return `waits on ${edge.id}`;
  if (edge.open === false) return `after ${edge.id} (closed)`;
  return `after ${edge.id}`;
}

function taskItem(task, extra = []) {
  const notes = [];
  if (task.inFlight) notes.push("in flight");
  if (task.overtaken) notes.push("overtaken");
  if (task.known === false) notes.push("not in this backlog");
  for (const edge of task.waitsOn) notes.push(edgeText(edge));
  if (task.unblocks.length) notes.push(`unblocks ${task.unblocks.join(", ")}`);
  notes.push(...extra);
  return el("li", { class: "task" }, [
    el("a", { class: "task-id", href: taskHref(task.id), "data-task": task.id, text: task.id }),
    task.title ? el("span", { class: "task-title", text: task.title }) : null,
    task.statusLabel ? el("span", { class: `role role-${task.role}`, text: task.statusLabel }) : null,
    notes.length ? el("span", { class: "task-notes", text: notes.join(" · ") }) : null,
  ]);
}

function taskList(tasks, emptyText, extra = () => []) {
  if (!tasks.length) return el("p", { class: "quiet", text: emptyText });
  return el("ul", { class: "tasks" }, tasks.map(t => taskItem(t, extra(t))));
}

/** A titled part of the plan: a card, or (`bare`) a plain section for content that is cards itself. */
function region(id, title, children, { bare = false } = {}) {
  if (bare) return el("section", { class: "plan-region", "aria-labelledby": id }, [el("h3", { id, text: title }), ...children]);
  return el("section", { class: "card plan-region", "aria-labelledby": id }, [
    el("div", { class: "card-head" }, [el("h3", { id, text: title })]),
    el("div", { class: "card-body" }, children),
  ]);
}

function renderWave(wave) {
  // The meter repeats the label's numbers for the eye; its width is set
  // through the CSSOM, which the page's CSP allows (a style attribute it does not).
  const fill = el("span");
  fill.style.width = wave.total ? `${Math.round((wave.closed / wave.total) * 100)}%` : "0";
  const head = el("summary", { class: "card-head wave-head" }, [
    icon("chevron-right", "icon wave-chevron"),
    el("span", { class: "wave-number", text: `Wave ${wave.number}` }),
    el("span", { class: "wave-name", text: wave.name }),
    el("span", { class: `badge role-neutral wave-state wave-state-${wave.state}`, text: wave.stateLabel }),
    el("span", { class: "end wave-progress" }, [el("span", { class: "meter", "aria-hidden": "true" }, [fill]), el("span", { text: wave.progressLabel })]),
  ]);
  const body = [];
  if (wave.groups.length) {
    for (const group of wave.groups) body.push(el("p", { class: "quiet", text: `Done as one: ${group.join(", ")}` }));
  }
  if (wave.endsOnHuman) body.push(el("p", { class: "quiet", text: "This wave ends on a person: an unattended run cannot close it on its own." }));
  body.push(taskList(wave.tasks, "This wave schedules no tasks."));
  const rail = el("div", { class: "wave-rail", "aria-hidden": "true" }, [
    el("span", { class: "dot" }, [wave.state === "closed" ? icon("check") : document.createTextNode(String(wave.number))]),
    el("span", { class: "line" }),
  ]);
  return el("li", { class: `wave wave-${wave.state}`, "data-state": wave.state, "aria-current": wave.active ? "step" : null }, [
    rail,
    el("details", { class: "card", open: !wave.collapsed }, [head, el("div", { class: "card-body" }, body)]),
  ]);
}

function renderPlan(model) {
  const parts = [];
  if (model.freshness.stale) {
    parts.push(el("p", { class: "state state-stale", role: "status", text: "Showing the last known plan; a fresh read is on its way." }));
  }
  if (model.state === "empty") {
    parts.push(el("div", { class: "state state-empty" }, [
      el("p", { text: model.emptyReason === "no-plan"
        ? "This backlog has no execution plan. That is fine: the order is an optional decision."
        : "The plan exists but schedules no waves yet." }),
      el("p", { text: "A plan is plan.yaml next to the tasks: an ordered list of waves, each a named batch of task ids. Once it has a wave, `branchling plan add <ID> --wave \"<name>\"` schedules more." }),
    ]));
    return parts;
  }

  parts.push(el("p", { class: "plan-summary", text: model.summary.parts.join(" · ") }));
  if (model.freshness.fetchedAt) {
    const at = new Date(model.freshness.fetchedAt);
    parts.push(el("p", { class: "quiet" }, [document.createTextNode("As of "), el("time", { datetime: model.freshness.fetchedAt, text: at.toLocaleString() })]));
  }
  if (model.rationale) {
    parts.push(el("figure", { class: "card card-pad plan-rationale" }, [
      el("figcaption", { text: "Why this order" }),
      el("blockquote", {}, [el("p", { text: model.rationale })]),
    ]));
  }
  if (!model.dependenciesKnown) {
    parts.push(el("p", { class: "state state-stale", role: "status", text: "Titles and dependencies could not be read; tasks are shown by id." }));
  }

  parts.push(region("plan-inflight", `In flight (${model.inFlight.length})`, [
    taskList(model.inFlight, "Nothing in the plan is in flight.", t => [`wave ${t.waveNumber}`]),
  ]));

  const startable = model.mayStartNow.length
    ? el("ul", { class: "tasks" }, model.mayStartNow.map(item => {
      if (!item.together) return taskItem(item.tasks[0], item.waitsOnHuman ? ["waits on a person"] : []);
      return el("li", { class: "group" }, [
        el("p", { class: "quiet", text: `Done as one${item.waitsOnHuman ? " · waits on a person" : ""}` }),
        el("ul", { class: "tasks" }, item.tasks.map(t => taskItem(t))),
      ]);
    }))
    : el("p", { class: "quiet", text: model.summary.finished ? "Every wave is closed; the plan is finished." : "Nothing in the active wave may start now." });
  parts.push(region("plan-next", "May start now", [startable]));

  parts.push(region("plan-waves", `Waves (${model.waves.length})`, [
    el("ol", { class: "waves" }, model.waves.map(renderWave)),
  ], { bare: true }));

  if (model.overtaken.length) {
    parts.push(region("plan-overtaken", `Overtaken (${model.overtaken.length})`, [
      el("p", { class: "quiet", text: "Closed in a wave after the active one: the order may want reshuffling." }),
      taskList(model.overtaken, "", t => [`wave ${t.waveNumber}`]),
    ]));
  }

  parts.push(region("plan-unplanned", `Unplanned (${model.unplanned.count})`, [
    el("p", { class: "plan-measure", text: model.unplanned.sentence }),
    taskList(model.unplanned.tasks, "Every open task is in the plan."),
  ]));
  parts.push(el("p", { class: "quiet", text: "The plan orders; it does not block. Status stays the only truth about what has happened." }));
  return parts;
}

/* ---------- the detail panel ---------- */

function renderDetail(model, retry) {
  const close = el("a", { class: "panel-close", href: closedHref(), "data-close": "", text: "Close" });
  if (model.state !== "ready") {
    return [el("h3", { id: "task-panel-title", tabindex: "-1", text: "Task" }), renderState(model, retry, "the task"), close];
  }
  const rows = [
    ["Status", el("span", { class: `role role-${model.statusRole}`, text: model.statusLabel || "unknown" })],
    // A priority is a square tag, never confused with a status pill (docs/design).
    ["Priority", el("span", { class: `prio role-${model.priorityRole}`, text: model.priority || "none" })],
    ["Blocked", document.createTextNode(model.blocked ? "yes" : "no")],
  ];
  if (model.file) rows.push(["File", el("code", { text: model.file })]);
  if (model.elsewhere) rows.push(["Other branches", document.createTextNode(String(model.elsewhere))]);
  const parts = [
    el("h3", { id: "task-panel-title", tabindex: "-1" }, [el("span", { class: "task-id", text: model.id }), document.createTextNode(model.title ? ` ${model.title}` : "")]),
    el("dl", { class: "facts" }, rows.map(([k, v]) => el("div", {}, [el("dt", { text: k }), el("dd", {}, [v])]))),
  ];
  if (model.blockers.length) {
    parts.push(el("h4", { text: "Blocked by" }), el("ul", { class: "tasks" }, model.blockers.map(b => el("li", { class: "task" }, [
      el("a", { class: "task-id", href: taskHref(b.id), "data-task": b.id, text: b.id }),
      b.title ? el("span", { class: "task-title", text: b.title }) : null,
      b.statusLabel ? el("span", { class: `role role-${b.role}`, text: b.statusLabel }) : null,
      el("span", { class: "task-notes", text: [b.resolved ? "resolved" : "unresolved", b.found ? null : "not found"].filter(Boolean).join(" · ") }),
    ]))));
  }
  parts.push(close);
  return parts;
}

/* ---------- wiring ---------- */

export function start(section) {
  document.title = "Backlog plan";
  const target = section.querySelector("#plan");
  const panel = el("aside", { id: "task-panel", class: "panel", "aria-labelledby": "task-panel-title", "aria-live": "polite", hidden: true });
  section.insertBefore(panel, target);
  let returnFocusTo = null;
  let detailRequest = 0;

  async function openTask(id, { focus = true } = {}) {
    const request = ++detailRequest;
    panel.hidden = false;
    panel.setAttribute("aria-busy", "true");
    panel.replaceChildren(...renderDetail(loadingState("task"), null));
    const answer = await getJson(`/api/task?id=${encodeURIComponent(id)}`);
    if (request !== detailRequest) return;
    let model;
    if (!answer.ok) model = failureModel("task", answer);
    else {
      try { model = taskDetailModel(answer.body, { stale: answer.stale, fetchedAt: answer.fetchedAt }); }
      catch (err) { model = shapeError("task", err); }
    }
    panel.replaceChildren(...renderDetail(model, () => openTask(id)));
    panel.setAttribute("aria-busy", "false");
    if (focus) panel.querySelector("#task-panel-title")?.focus();
  }

  function closeTask() {
    detailRequest++;
    panel.hidden = true;
    panel.replaceChildren();
    if (returnFocusTo && document.contains(returnFocusTo)) returnFocusTo.focus();
    returnFocusTo = null;
  }

  function syncFromUrl({ focus }) {
    const id = new URLSearchParams(location.search).get("task");
    if (id) openTask(id, { focus });
    else closeTask();
  }

  // Real links: they work with a reload, a new tab or no script at all; with
  // the script they open the panel in place and Back undoes it.
  section.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[data-task], a[data-close]");
    if (!link) return;
    event.preventDefault();
    if (link.hasAttribute("data-task")) {
      returnFocusTo = target.querySelector(`a[data-task="${CSS.escape(link.dataset.task)}"]`) || link;
      history.pushState(null, "", link.getAttribute("href"));
    } else {
      history.pushState(null, "", link.getAttribute("href"));
    }
    syncFromUrl({ focus: true });
  });
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      history.pushState(null, "", closedHref());
      syncFromUrl({ focus: true });
    }
  });
  window.addEventListener("popstate", () => syncFromUrl({ focus: false }));

  async function load() {
    target.setAttribute("aria-busy", "true");
    target.replaceChildren(renderState(loadingState("plan"), null, "the plan"));
    const [plan, tasks] = await Promise.all([getJson("/api/plan"), getJson("/api/plan/tasks")]);
    let model;
    if (!plan.ok) model = failureModel("plan", plan);
    else {
      const times = [plan.fetchedAt, tasks.ok ? tasks.fetchedAt : null].filter(Boolean).sort();
      try {
        model = planModel(plan.body, { stale: plan.stale || (tasks.ok && tasks.stale), fetchedAt: times[0] ?? null }, tasks.ok ? tasks.body : null);
      } catch (err) {
        model = shapeError("plan", err);
      }
    }
    if (model.root) document.getElementById("root").textContent = model.root;
    target.replaceChildren(...(model.state === "ready" || model.state === "empty" ? renderPlan(model) : [renderState(model, load, "the plan")]));
    target.setAttribute("aria-busy", "false");
  }

  load();
  syncFromUrl({ focus: false });
}
