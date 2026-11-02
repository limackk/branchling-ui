/**
 * The decisions view on the page (UI-5): fetches /api/decisions, builds the
 * shared view model (src/view-model/decisions.mjs, served at /view-model/) and
 * renders one form per open question into #decisions. An answer is POSTed to
 * /api/decide as JSON with the capability token; the server's write guard
 * checks it, and `branchling decide` records it. A refusal is shown with
 * branchling's text unchanged. Text goes in through textContent only.
 *
 * app.mjs imports this module and calls `start()` only when `?view=decisions`
 * is on screen. A question's task id links to `&task=<ID>`, which the shared
 * task panel (src/web/task.mjs, UI-27) opens over the questions.
 */

import { decisionRecorded, decisionsFailure, decisionsModel, DECISIONS_TEXT, validateDecision } from "/view-model/decisions.mjs";
import { unreachableState } from "/view-model/states.mjs";
import { taskPanelHref } from "/view-model/task.mjs";
// app.mjs imports this module dynamically, after it has run, so the cycle is
// harmless; `capability` is read only when an answer is sent.
import { capability } from "/app.mjs";

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

/** A failure (error or refusal) as a box with role="alert". */
function failureNode(model, retry) {
  const box = el("div", { class: `state state-${model.state}`, role: "alert" });
  box.append(el("h3", { text: model.title }), el("p", { class: "detail", text: model.detail }));
  if (model.details && model.details.length) {
    box.append(el("ul", { class: "refusal-details" }, model.details.map(line => el("li", { text: line }))));
  }
  if (model.refusalKind) box.append(el("p", { text: `Reason code: ${model.refusalKind}` }));
  if (retry) {
    const again = el("button", { type: "button", text: "Try again" });
    again.addEventListener("click", retry);
    box.append(again);
  }
  return box;
}

let formCount = 0;

function questionForm(q) {
  const n = ++formCount;
  const form = el("form", { class: "decision-form", novalidate: "" });
  const fieldset = el("fieldset");
  fieldset.append(el("legend", { text: `Answer the question on ${q.taskId}` }));

  const reasonId = `decision-${n}-reason`;
  const reason = el("textarea", { id: reasonId, class: "textarea", name: "reason", rows: "3", maxlength: "2000" });
  let ownWords = null;
  if (q.options.length) {
    const group = el("fieldset", { class: "choices decision-options" }, [el("legend", { text: DECISIONS_TEXT.optionsLegend })]);
    // Each option is a radio card: the whole label is the target.
    for (const option of q.options) {
      const id = `decision-${n}-option-${option.number}`;
      group.append(el("label", { class: "choice decision-option", for: id }, [
        el("input", { type: "radio", id, name: "choice", value: String(option.number) }),
        el("span", { text: `${option.number}. ${option.label}` }),
      ]));
    }
    const ownId = `decision-${n}-own`;
    ownWords = el("input", { type: "radio", id: ownId, name: "choice", value: "own" });
    group.append(el("label", { class: "choice decision-option", for: ownId }, [ownWords, el("span", { text: DECISIONS_TEXT.ownWords })]));
    fieldset.append(group);
    reason.addEventListener("input", () => { if (reason.value.trim()) ownWords.checked = true; });
  } else if (q.optionsNote) {
    fieldset.append(el("p", { class: "bucket-note", text: q.optionsNote }));
  }
  fieldset.append(el("label", { for: reasonId, class: "decision-reason-label", text: DECISIONS_TEXT.reasonLabel }), reason);
  const submit = el("button", { type: "submit", text: DECISIONS_TEXT.submit });
  fieldset.append(submit);
  const feedback = el("div", { class: "decision-feedback", "aria-live": "polite" });
  form.append(fieldset, feedback);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const picked = form.querySelector('input[name="choice"]:checked');
    const input = { id: q.taskId, resolves: q.questionId };
    if (picked && picked.value !== "own") input.choose = Number(picked.value);
    else input.reason = reason.value;
    const checked = validateDecision(input);
    if (!checked.ok) {
      feedback.replaceChildren(el("p", { class: "state state-error", role: "alert", text: checked.message }));
      return;
    }
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    feedback.replaceChildren(el("p", { role: "status", text: DECISIONS_TEXT.submitting }));
    let failure = null;
    let recorded = null;
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-Branchling-UI-Capability": capability },
        body: JSON.stringify(checked.value),
      });
      const json = await res.json().catch(() => null);
      if (res.ok) recorded = decisionRecorded(json);
      else failure = decisionsFailure(json, res.status);
    } catch (err) {
      failure = unreachableState("decisions", err.message);
    }
    submit.disabled = false;
    form.setAttribute("aria-busy", "false");
    if (failure) {
      feedback.replaceChildren(failureNode(failure));
      // Disabling the button dropped focus to the page; give it back so the
      // person can correct the answer and send it again from where they were.
      submit.focus();
      return;
    }
    announce(recorded);
    load();
  });
  return form;
}

function questionNode(q) {
  const meta = [q.statusLabel, q.priority, `asked by ${q.askedBy}`].filter(Boolean).join(" · ");
  const when = q.askedAt ? el("time", { datetime: q.askedAt, title: q.askedAt, text: q.ageLabel }) : document.createTextNode(q.ageLabel);
  return el("li", { class: "card decision" }, [
    el("h3", {}, [el("a", { class: "task-id", href: taskPanelHref(location.search, q.taskId), "data-task": q.taskId, text: q.taskId }), ` ${q.title}`]),
    el("p", { class: "task-meta asked" }, [`${meta} · `, when]),
    el("p", { class: "question decision-question" }, [el("span", { class: "visually-hidden", text: "Question: " }), q.text]),
    el("p", { class: "bucket-note", text: q.needs }),
    questionForm(q),
  ]);
}

let body = null;
let notice = null;
let generation = 0;

/** The last recorded answer, kept above the list while it reloads. */
function announce(recorded) {
  const parts = [el("p", { text: recorded.message })];
  if (recorded.liftedLabel) parts.push(el("p", { text: recorded.liftedLabel }));
  if (recorded.remainingLabel) parts.push(el("p", { text: recorded.remainingLabel }));
  notice.replaceChildren(el("div", { class: "state state-recorded", tabindex: "-1" }, parts));
  // The answered form is about to disappear; keep keyboard focus on what happened.
  notice.firstChild.focus();
}

async function load() {
  const target = document.getElementById("decisions");
  if (!target) return;
  if (!body) {
    notice = el("div", { class: "decision-notice", "aria-live": "polite" });
    body = el("div", { "aria-live": "polite" });
    target.replaceChildren(notice, body);
  }
  const mine = ++generation;
  body.setAttribute("aria-busy", "true");
  if (!body.firstChild) body.replaceChildren(el("p", { class: "state state-loading", role: "status", text: DECISIONS_TEXT.loading }));
  let model;
  try {
    const res = await fetch("/api/decisions", { headers: { Accept: "application/json" } });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      model = decisionsFailure(json, res.status);
    } else {
      model = decisionsModel(json, {
        stale: res.headers.get("x-branchling-ui-stale") === "1",
        fetchedAt: res.headers.get("x-branchling-ui-fetched-at"),
      }, Date.now());
    }
  } catch (err) {
    model = unreachableState("decisions", err.message);
  }
  if (mine !== generation) return;
  if (model.state === "ready" || model.state === "empty") {
    const parts = [];
    if (model.freshness.stale) parts.push(el("p", { class: "state state-stale", role: "status", text: DECISIONS_TEXT.stale }));
    if (model.state === "empty") {
      parts.push(el("p", { class: "state state-empty", text: model.emptyText }));
    } else {
      parts.push(el("p", { class: "decisions-summary", text: model.summary }));
      parts.push(el("ol", { class: "decisions" }, model.questions.map(questionNode)));
    }
    body.replaceChildren(...parts);
  } else {
    body.replaceChildren(failureNode(model, load));
  }
  body.setAttribute("aria-busy", "false");
}

/** Called by app.mjs when `?view=decisions` is on screen. */
export function start() {
  load();
}
