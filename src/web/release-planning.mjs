/**
 * Release planning on the page (UI-8), after the Planning tab of
 * docs/design/mockups/releases.html: "Declare a release" and "Plan tasks for
 * <release>", under the release view's pipeline and comparison. The release
 * view (src/web/release.mjs) owns the selection in the URL (`?release=`) and
 * the comparison of plan with shipped (`deploy status --release`); this
 * module only adds the two writes and tells it when to read again.
 *
 *   declare  POST /api/release/declare  `declare releases <name> --reason "…" [--ref]`
 *   plan     POST /api/task/field       `set <ID> release <name>`, one per task:
 *                                       UI-6's route, not a second write path
 *
 * Both send the capability token; the server's write guard checks it. Text
 * goes in through textContent only. Built once, so a reload of the release
 * data keeps focus and what was typed.
 */

import {
  DECLARE_PATH, PLANNING_TEXT, declareCommand, declareFailure, declareRecorded,
  planChanges, planCommand, planningModel, seenReleases, validateDeclare,
} from "/view-model/release-planning.mjs";
import { FIELD_EDIT_PATH, fieldEditFailure } from "/view-model/task-fields.mjs";
import { fromApiError, unreachableState } from "/view-model/states.mjs";

const capability = () => document.querySelector('meta[name="branchling-ui-capability"]')?.content || "";

/** The datalist the release view's release box suggests from. */
export const SEEN_LIST_ID = "release-seen";

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `/icons.svg#${name}`);
  svg.append(use);
  return svg;
}

function field(name, label, control, hint, extra) {
  const hintId = `release-declare-${name}-hint`;
  const errId = `release-declare-${name}-error`;
  control.id = `release-declare-${name}`;
  control.name = name;
  control.setAttribute("aria-describedby", hint ? hintId : errId);
  const labelNode = el("label", { for: control.id, text: label });
  if (extra) labelNode.append(" ", el("span", { class: "req", text: extra }));
  const err = el("span", { id: errId, class: "error", hidden: true });
  const hintNode = hint ? el("span", { id: hintId, class: "hint", text: hint }) : null;
  const wrap = el("div", { class: "field" }, [labelNode, control, hintNode, err]);
  return { wrap, control, err, hintId, errId, hint, hintNode };
}

function setError(f, message) {
  f.control.setAttribute("aria-invalid", message ? "true" : "false");
  f.err.hidden = !message;
  f.err.replaceChildren(...(message ? [icon("alert"), message] : []));
  f.control.setAttribute("aria-describedby", [f.hintNode ? f.hintId : null, message ? f.errId : null].filter(Boolean).join(" ") || f.errId);
}

function commandNode(parts) {
  return el("div", { class: "cmd" }, [el("code", {}, parts.map(p => (p.arg ? el("span", { class: "arg", text: p.text }) : document.createTextNode(p.text))))]);
}

function failureNode(failure) {
  const box = el("div", { class: `state state-${failure.state} release-planning-failure`, role: "alert", tabindex: "-1" }, [
    el("div", { class: "state-head" }, [icon(failure.state === "error" ? "alert" : "stop"), failure.title]),
    el("p", { class: "detail", text: failure.detail }),
  ]);
  if (failure.details && failure.details.length) box.append(el("pre", { class: "release-planning-details" }, [el("code", { text: failure.details.join("\n") })]));
  const meta = [failure.refusalKindText, failure.nothingWritten].filter(Boolean).join(". ").replace(/\.\./g, ".");
  if (meta) box.append(el("p", { class: "t-meta", text: meta }));
  return box;
}

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Branchling-UI-Capability": capability() },
    body: JSON.stringify(body),
  });
  return { res, json: await res.json().catch(() => null) };
}

/**
 * @param {{ onDeclared: (name: string) => void, onPlanned: () => void }} hooks
 *   onDeclared selects the new release (the URL); onPlanned reads the
 *   comparison again. Both belong to the release view.
 */
export function createPlanning({ onDeclared, onPlanned }) {
  const declaredHere = [];
  let lastList = null;
  let lastStatus = null;
  const seen = el("datalist", { id: SEEN_LIST_ID });

  function refreshSeen() {
    const names = seenReleases({ list: lastList, status: lastStatus, declared: declaredHere });
    seen.replaceChildren(...names.map(name => el("option", { value: name })));
  }

  /* ---------- declare ---------- */

  const fields = {
    name: field("name", PLANNING_TEXT.nameLabel, el("input", { class: "input mono", type: "text", autocomplete: "off", spellcheck: "false", maxlength: "64" }), PLANNING_TEXT.nameHint),
    ref: field("ref", PLANNING_TEXT.refLabel, el("input", { class: "input mono", type: "text", autocomplete: "off", spellcheck: "false", maxlength: "256" }), PLANNING_TEXT.refHint, PLANNING_TEXT.refOptional),
    reason: field("reason", PLANNING_TEXT.reasonLabel, el("textarea", { class: "textarea", rows: "2", maxlength: "2000", required: true }), PLANNING_TEXT.reasonHint, PLANNING_TEXT.reasonRequired),
  };
  const preview = el("div", {});
  const redraw = () => preview.replaceChildren(commandNode(declareCommand(fields.name.control.value, fields.reason.control.value, fields.ref.control.value).parts));
  for (const f of Object.values(fields)) f.control.addEventListener("input", redraw);
  redraw();
  const declareFeedback = el("div", { class: "release-planning-feedback" });
  const declareButton = el("button", { type: "submit", class: "btn btn-primary" }, [icon("plus"), PLANNING_TEXT.declare]);
  const declareForm = el("form", { class: "card release-declare", "aria-labelledby": "release-declare-title", novalidate: true, "data-draft": "" }, [
    el("div", { class: "card-head" }, [el("h3", { id: "release-declare-title", text: PLANNING_TEXT.declareHeading })]),
    el("div", { class: "card-body stack" }, [
      declareFeedback,
      fields.name.wrap,
      fields.ref.wrap,
      fields.reason.wrap,
      preview,
      el("p", { class: "t-meta", text: PLANNING_TEXT.changeIsHandEdit }),
    ]),
    el("div", { class: "card-foot row" }, [declareButton]),
  ]);

  declareForm.addEventListener("submit", async event => {
    event.preventDefault();
    const input = { name: fields.name.control.value, reason: fields.reason.control.value, ref: fields.ref.control.value };
    const checked = validateDeclare(input);
    for (const f of Object.values(fields)) setError(f, null);
    declareFeedback.replaceChildren();
    if (!checked.ok) {
      const f = fields[checked.field];
      if (f) { setError(f, checked.message); f.control.focus(); return; }
      const node = failureNode({ state: "error", title: checked.message, detail: "" });
      declareFeedback.replaceChildren(node);
      node.focus();
      return;
    }
    declareButton.disabled = true;
    declareForm.setAttribute("aria-busy", "true");
    declareFeedback.replaceChildren(el("p", { class: "state state-loading", role: "status", text: PLANNING_TEXT.sending }));
    let failure = null;
    let result = null;
    try {
      const { res, json } = await post(DECLARE_PATH, checked.value);
      if (res.ok) result = json;
      else failure = declareFailure(json, res.status);
    } catch (err) {
      failure = { ...unreachableState("release", err.message), details: [] };
    }
    declareButton.disabled = false;
    declareForm.setAttribute("aria-busy", "false");
    if (failure) {
      // What was typed stays; the person corrects it and declares again.
      const node = failureNode(failure);
      declareFeedback.replaceChildren(node);
      node.focus();
      return;
    }
    const rec = declareRecorded(result);
    const box = el("div", { class: "state state-recorded", role: "status", tabindex: "-1" }, [
      el("p", { text: rec.message }),
      rec.refText ? el("p", { text: rec.refText }) : null,
      el("p", { text: rec.next }),
    ]);
    declareFeedback.replaceChildren(box);
    for (const f of Object.values(fields)) f.control.value = "";
    redraw();
    if (rec.name) declaredHere.push(rec.name);
    refreshSeen();
    box.focus();
    if (rec.name) onDeclared(rec.name);
  });

  /* ---------- plan tasks ---------- */

  const planTitle = el("h3", { id: "release-plan-title", text: PLANNING_TEXT.heading });
  const planAside = el("span", { class: "end t-meta" }, [`${PLANNING_TEXT.planNote} `, el("code", { text: planCommand("<ID>", "…") })]);
  const planBody = el("div", { class: "release-plan-body", "aria-live": "polite" });
  const planCard = el("section", { class: "card release-plan", "aria-labelledby": "release-plan-title" }, [
    el("div", { class: "card-head" }, [planTitle, planAside]),
    planBody,
  ]);

  let planGeneration = 0;
  let planFor = null;
  let planFeedback = null;
  /** The result of a planning run, shown again over the list read after it. */
  let pendingFeedback = null;

  function note(text) {
    return el("div", { class: "card-body" }, [el("p", { class: "t-meta", text })]);
  }

  function renderPlan(model, release) {
    const boxes = model.tasks.map(task => {
      const id = `release-plan-${task.id}`;
      const box = el("input", { type: "checkbox", id, value: task.id, checked: task.planned });
      const meta = [task.statusLabel, task.elsewhereText].filter(Boolean).join(" · ");
      return el("li", {}, [
        el("label", { class: "check", for: id }, [box, el("span", { class: "task-id", text: task.id }), " ", el("span", { text: task.title })]),
        meta ? el("span", { class: "t-meta", text: meta }) : null,
      ]);
    });
    const reason = el("textarea", { id: "release-plan-reason", class: "textarea", rows: "2", maxlength: "2000", "aria-describedby": "release-plan-reason-hint" });
    const apply = el("button", { type: "submit", class: "btn btn-primary" }, [icon("flag"), PLANNING_TEXT.planApply(0)]);
    const feedback = el("div", { class: "release-planning-feedback" });
    planFeedback = feedback;
    const form = el("form", { class: "release-plan-form", "aria-labelledby": "release-plan-title", novalidate: true, "data-draft": "" }, [
      el("div", { class: "card-body stack" }, [
        el("p", { class: "t-meta", text: PLANNING_TEXT.planScope }),
        el("fieldset", { class: "release-plan-tasks" }, [
          el("legend", { class: "visually-hidden", text: PLANNING_TEXT.planHeading(release) }),
          el("ul", { class: "tlist" }, boxes),
        ]),
        el("div", { class: "field" }, [
          el("label", { for: reason.id }, [PLANNING_TEXT.planReasonLabel, " ", el("span", { class: "req", text: PLANNING_TEXT.planReasonOptional })]),
          reason,
          el("span", { id: "release-plan-reason-hint", class: "hint", text: PLANNING_TEXT.actorNote }),
        ]),
        feedback,
      ]),
      el("div", { class: "card-foot row" }, [apply, el("span", { class: "t-meta", text: PLANNING_TEXT.planHistory })]),
    ]);
    const ticked = () => [...form.querySelectorAll('input[type="checkbox"]')].filter(b => b.checked).map(b => b.value);
    const recount = () => {
      const n = planChanges(model, ticked(), release).length;
      apply.replaceChildren(icon("flag"), PLANNING_TEXT.planApply(n));
    };
    form.addEventListener("change", recount);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const changes = planChanges(model, ticked(), release);
      if (!changes.length) {
        feedback.replaceChildren(el("p", { class: "t-meta", role: "status", text: PLANNING_TEXT.planNothing }));
        return;
      }
      apply.disabled = true;
      form.setAttribute("aria-busy", "true");
      const why = reason.value.trim();
      const done = [];
      let failed = null;
      for (const change of changes) {
        feedback.replaceChildren(el("p", { class: "state state-loading", role: "status", text: PLANNING_TEXT.planRunning(done.length, changes.length) }));
        try {
          const { res, json } = await post(FIELD_EDIT_PATH, { ...change, ...(why ? { reason: why } : {}) });
          if (!res.ok) { failed = { change, failure: fieldEditFailure(json, res.status) }; break; }
          done.push({ change, result: json });
        } catch (err) {
          failed = { change, failure: { ...unreachableState("release", err.message), details: [] } };
          break;
        }
      }
      apply.disabled = false;
      form.setAttribute("aria-busy", "false");
      const lines = done.map(({ change, result }) => el("li", {
        text: Array.isArray(result && result.changes) && result.changes.length ? PLANNING_TEXT.planRecorded(change.id, change.value) : PLANNING_TEXT.planUnchanged(change.id),
      }));
      const parts = [];
      if (lines.length) {
        const actor = done.map(d => d.result && d.result.actor).find(a => typeof a === "string" && a);
        parts.push(el("div", { class: "state state-recorded", role: "status", tabindex: "-1" }, [
          el("ul", {}, lines),
          actor ? el("p", { text: `${PLANNING_TEXT.recordedActor} ${actor}. ${PLANNING_TEXT.actorNote}` }) : null,
        ]));
      }
      if (failed) {
        const node = failureNode({ ...failed.failure, title: `${PLANNING_TEXT.planFailed(failed.change.id)} ${failed.failure.title}` });
        if (done.length + 1 < changes.length) node.append(el("p", { class: "t-meta", text: PLANNING_TEXT.planStopped }));
        parts.push(node);
      }
      if (!done.length) {
        // Nothing changed: keep the boxes as ticked, so the person can retry.
        feedback.replaceChildren(...parts);
        parts.at(-1).focus();
        return;
      }
      // Something was written: read the comparison and the tasks again, and
      // show the result over the fresh list (loadPlan).
      pendingFeedback = parts;
      onPlanned();
    });
    return form;
  }

  async function loadPlan(release) {
    const mine = ++planGeneration;
    planBody.setAttribute("aria-busy", "true");
    planBody.replaceChildren(note(PLANNING_TEXT.planLoading));
    let content;
    try {
      const res = await fetch("/api/tasks", { headers: { Accept: "application/json" } });
      const json = await res.json().catch(() => null);
      if (mine !== planGeneration) return;
      if (!res.ok) {
        const model = fromApiError("release", json, res.status);
        content = el("div", { class: "card-body" }, [failureNode({ ...model, details: [] })]);
      } else {
        lastList = json;
        refreshSeen();
        const model = planningModel(json, release);
        content = model.state === "empty" ? note(PLANNING_TEXT.planEmpty) : renderPlan(model, release);
      }
    } catch (err) {
      if (mine !== planGeneration) return;
      content = el("div", { class: "card-body" }, [failureNode({ ...unreachableState("release", err.message), details: [] })]);
    }
    planBody.replaceChildren(content);
    planBody.setAttribute("aria-busy", "false");
    if (pendingFeedback && planFeedback) {
      planFeedback.replaceChildren(...pendingFeedback);
      pendingFeedback.find(n => n.getAttribute("role") === "alert" || n.getAttribute("role") === "status")?.focus();
      pendingFeedback = null;
    }
  }

  const node = el("section", { class: "release-planning", "aria-labelledby": "release-planning-title" }, [
    el("h3", { id: "release-planning-title", class: "t-section", text: PLANNING_TEXT.heading }),
    el("div", { class: "grid grid-2 release-planning-grid" }, [declareForm, planCard]),
    seen,
  ]);

  return {
    node,
    /**
     * Called by the release view after every read: the selected release, the
     * `release-status` envelope when the read succeeded, and whether
     * branchling accepted the release (a rejected one cannot be planned for).
     */
    update({ release, status, known, reload = false }) {
      if (status) { lastStatus = status; refreshSeen(); }
      const name = release || "";
      if (!name) {
        planFor = null;
        planTitle.textContent = PLANNING_TEXT.heading;
        planBody.replaceChildren(note(PLANNING_TEXT.planNone));
        return;
      }
      planTitle.textContent = PLANNING_TEXT.planHeading(name);
      planAside.replaceChildren(`${PLANNING_TEXT.planNote} `, el("code", { text: planCommand("<ID>", name) }));
      if (!known) {
        planFor = null;
        planBody.replaceChildren(note(PLANNING_TEXT.planNone));
        return;
      }
      if (planFor === name && !reload && !pendingFeedback) return;
      planFor = name;
      loadPlan(name);
    },
    /** Moves focus to the declare form's first box (the release view's button). */
    focusDeclare() {
      fields.name.control.focus();
    },
  };
}
