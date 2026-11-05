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
 *
 * ACTIONS (UI-30, after docs/design/mockups/flows.html). The panel offers
 * Take, Return to queue and Hand off. Each opens a confirmation, a second
 * modal `<dialog>` over the panel, that names the branchling command and asks
 * for what it requires (a reason; a role for a handoff). It is POSTed as JSON
 * with the capability token; the server's write guard checks it and
 * branchling runs. A refusal is shown inside the confirmation with
 * branchling's text unchanged; nothing was written. A success closes it,
 * reads the panel again (the cache was invalidated by the write, so the read
 * is fresh) and says what branchling recorded and as whom. Focus returns to
 * the button that opened the confirmation, or moves to that message.
 *
 * FIELD EDITS (UI-6, after mockups/task.html and flows.html "Edit a field").
 * Every field `branchling set --fields` reports (UI-39) gets a pen button in
 * the Fields list (fieldEdits in src/view-model/task-fields.mjs says which,
 * and what the box starts with); a build that cannot report them gets a note
 * and no pens. It opens the edit form in the same second `<dialog>`: a
 * labelled control for the value, an optional reason, and the command it
 * will run. A closed vocabulary (UI-43) is a choice of the declared values:
 * a select for one value, a group of checkboxes for a list; a suggested
 * vocabulary is a text box with the declared values as suggestions; every
 * other field is free text. branchling still judges the value. Saving POSTs
 * `{ id, field, value, reason }` to /api/task/field; a refusal is shown in
 * the form with branchling's text unchanged, a value outside the vocabulary
 * or a missing reason also marks the box to fix, what was typed is kept,
 * and the person corrects it and saves again. A
 * success closes the form, reads the panel again (fresh: the write
 * invalidated the cache), says what branchling recorded and as whom, and
 * returns focus to the edited field's pen.
 */

import {
  TASK_ID_SHAPE, TASK_TEXT,
  safeHref, taskNotFound, taskPanelClosedHref, taskPanelFailure, taskPanelLoading, taskPanelModel, taskParam,
} from "/view-model/task.mjs";
import { fromApiError, unreachableState } from "/view-model/states.mjs";
import {
  TASK_ACTIONS, TASK_ACTIONS_TEXT, actionCommand, actionPath, taskActionFailure, taskActionRecorded, validateTaskAction,
} from "/view-model/task-actions.mjs";
import {
  FIELD_EDIT_PATH, FIELD_EDIT_TEXT, choiceValue, fieldCommand, fieldEditFailure, fieldEditRecorded, fieldEdits, fieldEditsNote, validateFieldEdit,
} from "/view-model/task-fields.mjs";

/** The capability a write sends; read from the page, as app.mjs does. */
const capability = () => document.querySelector('meta[name="branchling-ui-capability"]')?.content || "";

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
let confirmBox;       // the confirmation <dialog> of an action
let recorded = null;  // { id, model } of the last action, shown once over the re-read panel
let edited = null;    // { id, model } of the last field edit, shown once over the re-read panel

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

  parts.push(actionsSection(model));

  parts.push(fieldsSection(model));

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

/* ---------- fields, and their edits (UI-6) ---------- */

function editButton(edit, model, content) {
  const button = el("button", {
    type: "button",
    class: "editable",
    "data-edit": edit.key,
    "aria-label": FIELD_EDIT_TEXT.edit(edit.label, edit.display),
  }, [content, icon("pen")]);
  button.lastChild.classList.add("pen");
  button.addEventListener("click", () => openEdit(edit, model, button));
  return button;
}

function fieldsSection(model) {
  const edits = Array.isArray(model.edits) ? model.edits : [];
  const editOf = key => edits.find(e => e.key === key) || null;
  const rows = model.fields.flatMap(f => {
    const edit = editOf(f.key);
    return [el("dt", { text: f.label }), el("dd", {}, [edit ? editButton(edit, model, fieldValue(f)) : fieldValue(f)])];
  });
  // Editable fields the list above does not show (title, blocked by, …).
  for (const edit of edits) {
    if (model.fields.some(f => f.key === edit.key)) continue;
    const value = edit.known && edit.current ? document.createTextNode(edit.current) : el("span", { class: "task-panel-none", text: edit.known ? TASK_TEXT.none : edit.display });
    rows.push(el("dt", { text: edit.label }), el("dd", {}, [editButton(edit, model, value)]));
  }
  const children = [el("dl", { class: "kv" }, rows)];
  if (!model.fieldsKnown) children.push(el("p", { class: "task-panel-note", text: TASK_TEXT.fieldsUnknown }));
  if (model.editsNote) children.push(el("p", { class: "task-panel-note", text: model.editsNote }));
  if (edited && edited.id === model.id) children.unshift(recordedNode(edited.model));
  const aside = edits.length ? el("span", { class: "t-meta" }, [`${FIELD_EDIT_TEXT.sectionNote} `, el("code", { text: "branchling set" })]) : null;
  return section("task-panel-fields", TASK_TEXT.fields, children, aside);
}

function editCommandNode(id, field, value, reason) {
  const code = el("code", {}, fieldCommand(id, field, value, reason).parts.map(p => (p.arg ? el("span", { class: "arg", text: p.text }) : document.createTextNode(p.text))));
  return el("div", { class: "cmd" }, [code]);
}

function openEdit(edit, model, opener) {
  const id = model.id;
  if (!confirmBox) {
    confirmBox = el("dialog", { class: "dialog task-action-dialog", "aria-labelledby": "task-action-title" });
    document.body.append(confirmBox);
  }
  const fields = {
    value: valueField(edit),
    reason: fieldNode("reason", FIELD_EDIT_TEXT.reasonLabel, el("textarea", { class: "textarea", maxlength: "2000", rows: "2" }), FIELD_EDIT_TEXT.reasonHint),
  };
  fields.reason.wrap.querySelector("label").append(" ", el("span", { class: "req", text: FIELD_EDIT_TEXT.reasonOptional }));
  const feedback = el("div", { class: "task-action-feedback" });
  const cmd = el("div", {}, [editCommandNode(id, edit.key, fields.value.control.value, "")]);
  const redraw = () => cmd.replaceChildren(editCommandNode(id, edit.key, fields.value.control.value, fields.reason.control.value));
  fields.value.wrap.addEventListener("input", redraw);
  fields.value.wrap.addEventListener("change", redraw);
  fields.reason.control.addEventListener("input", redraw);
  const submit = el("button", { type: "submit", class: "btn btn-primary" }, [icon("pen"), FIELD_EDIT_TEXT.save]);
  const cancel = el("button", { type: "button", class: "btn btn-ghost", text: FIELD_EDIT_TEXT.cancel });
  cancel.addEventListener("click", closeConfirm);
  const form = el("form", { class: "task-action-form task-field-form", novalidate: true }, [
    el("div", { class: "dialog-head" }, [
      el("h2", { id: "task-action-title", class: "t-section", text: FIELD_EDIT_TEXT.title(edit.label, id) }),
      model.title && model.title !== id ? el("p", { class: "t-meta", text: model.title }) : null,
    ]),
    el("div", { class: "dialog-body" }, [
      feedback,
      fields.value.wrap,
      fields.reason.wrap,
      cmd,
      el("p", { class: "t-meta", text: FIELD_EDIT_TEXT.actorNote }),
    ]),
    el("div", { class: "dialog-foot" }, [cancel, submit]),
  ]);
  form.addEventListener("submit", event => {
    event.preventDefault();
    sendEdit(id, edit.key, fields, { form, submit, cancel, feedback });
  });
  confirmBox.replaceChildren(form);
  confirmBox.onclose = () => {
    // Back to the pen that opened it, or to the same pen redrawn after a save.
    const target = opener.isConnected ? opener : body.querySelector(`button[data-edit="${CSS.escape(edit.key)}"]`);
    (target || title)?.focus();
    confirmBox.dataset.done = "";
  };
  confirmBox.showModal();
  fields.value.control.focus();
  if (typeof fields.value.control.select === "function" && edit.control === "text") fields.value.control.select();
}

/**
 * The value's control, from the field model (UI-43): a select of the
 * declared values, a group of checkboxes for a list with a closed
 * vocabulary, or a text box (with the suggested values, if any, as a
 * datalist). Whatever the control, `control.value` reads what would be sent,
 * so the command line, the check and the POST treat them alike.
 */
function valueField(edit) {
  if (edit.control === "select") {
    const select = el("select", { class: "select" }, edit.options.map(o => el("option", { value: o.value, text: o.label })));
    const field = fieldNode("value", FIELD_EDIT_TEXT.valueLabel, select, edit.hint);
    select.selectedIndex = Math.max(0, edit.options.findIndex(o => o.selected));
    return field;
  }
  if (edit.control === "checkboxes") {
    const hintId = "task-action-value-hint";
    const errId = "task-action-value-error";
    const boxes = edit.options.map((o, i) => {
      const box = el("input", { type: "checkbox", id: `task-action-value-${i}`, name: "value", value: o.value });
      box.checked = o.selected;
      return { option: o, box, label: el("label", { class: "choice", for: box.id }, [box, el("span", { text: o.label })]) };
    });
    const legend = el("legend", { text: FIELD_EDIT_TEXT.valueLabel });
    const group = el("fieldset", { class: "choices", id: "task-action-value", tabindex: "-1", "aria-describedby": hintId }, [legend, ...boxes.map(b => b.label)]);
    // The fieldset stands in for one control: it reads the ticked values, takes focus and error marks.
    Object.defineProperty(group, "value", { get: () => choiceValue(boxes.map(b => ({ ...b.option, selected: b.box.checked }))) });
    group.focus = () => (boxes[0] ? boxes[0].box.focus() : HTMLElement.prototype.focus.call(group));
    const err = el("span", { id: errId, class: "error", hidden: true });
    const hintNode = edit.hint ? el("span", { id: hintId, class: "hint", text: edit.hint }) : null;
    const wrap = el("div", { class: "field" }, [group, hintNode, err]);
    return { wrap, control: group, err, hintId, errId, hint: edit.hint, hintNode };
  }
  const input = el("input", { class: "input", type: "text", autocomplete: "off", spellcheck: "false", maxlength: "2000" });
  const field = fieldNode("value", FIELD_EDIT_TEXT.valueLabel, input, edit.hint);
  input.value = edit.known ? edit.current : "";
  // A suggested vocabulary (estimates, labels) is offered; another value may still be typed.
  if (edit.suggested && edit.suggested.length) {
    const list = el("datalist", { id: "task-action-value-options" }, edit.suggested.map(v => el("option", { value: v })));
    input.setAttribute("list", list.id);
    field.wrap.append(list);
  }
  return field;
}

async function sendEdit(id, field, fields, { form, submit, cancel, feedback }) {
  const input = { id, field, value: fields.value.control.value, reason: fields.reason.control.value };
  const checked = validateFieldEdit(input);
  for (const f of Object.values(fields)) setFieldError(f, null);
  feedback.replaceChildren();
  if (!checked.ok) {
    const f = fields[checked.field];
    if (f) { setFieldError(f, checked.message); f.control.focus(); return; }
    feedback.replaceChildren(failureNode({ state: "error", title: checked.message, detail: "" }));
    return;
  }
  submit.disabled = true;
  cancel.disabled = true;
  form.setAttribute("aria-busy", "true");
  feedback.replaceChildren(el("p", { class: "state state-loading", role: "status", text: FIELD_EDIT_TEXT.sending }));
  let failure = null;
  let result = null;
  try {
    const res = await fetch(FIELD_EDIT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Branchling-UI-Capability": capability() },
      body: JSON.stringify(checked.value),
    });
    const json = await res.json().catch(() => null);
    if (res.ok) result = json;
    else failure = fieldEditFailure(json, res.status);
  } catch (err) {
    failure = { ...unreachableState("task", err.message), action: "set" };
  }
  submit.disabled = false;
  cancel.disabled = false;
  form.setAttribute("aria-busy", "false");
  if (failure) {
    // What was typed stays; the person corrects it (or adds a reason) and saves again.
    const node = failureNode(failure);
    feedback.replaceChildren(node);
    const target = failure.fix && fields[failure.fix.field];
    if (target) {
      // The box to fix is named and focused; the refusal above keeps branchling's own words.
      setFieldError(target, failure.fix.message);
      target.control.focus();
    } else {
      node.focus();
    }
    return;
  }
  recorded = null;
  edited = { id, model: fieldEditRecorded(result) };
  // The write invalidated the cache: this read is fresh.
  await show(id, { reload: true, keepRecorded: true });
  if (shownId === id && !(lastModel && lastModel.state === "ready")) body.prepend(recordedNode(edited.model));
  confirmBox.dataset.done = "1";
  closeConfirm();
}

/* ---------- actions: take, release, handoff ---------- */

const ACTION_ICONS = { take: "play", release: "undo", handoff: "handoff" };

function recordedNode(rec) {
  const box = el("div", { class: "state state-recorded task-action-recorded", role: "status", tabindex: "-1" }, [
    el("p", { class: "task-action-message", text: rec.message }),
  ]);
  if (rec.changes.length) box.append(el("ul", { class: "task-panel-changes" }, rec.changes.map(c => el("li", { text: c.text }))));
  if (rec.note) box.append(el("p", { text: rec.note }));
  box.append(el("p", { class: "task-action-actor", text: rec.actorText }));
  return box;
}

function failureNode(failure) {
  const box = el("div", { class: `state state-${failure.state} task-action-failure`, role: "alert", tabindex: "-1" }, [
    el("div", { class: "state-head" }, [icon(failure.state === "error" ? "alert" : "stop"), failure.title]),
    // `.detail` draws branchling's own words; the rejected state's sentence is ours.
    el("p", { class: failure.state === "rejected" ? null : "detail", text: failure.detail }),
  ]);
  if (failure.details && failure.details.length) box.append(el("pre", { class: "task-action-details" }, [el("code", { text: failure.details.join("\n") })]));
  if (failure.branchlingSaid) box.append(el("p", {}, [`${failure.branchlingSaidLabel}: `]), el("pre", { class: "task-action-details" }, [el("code", { text: failure.branchlingSaid })]));
  const meta = [failure.refusalKindText, failure.nothingWritten].filter(Boolean).join(". ").replace(/\.\./g, ".");
  if (meta) box.append(el("p", { class: "t-meta task-action-meta", text: meta }));
  return box;
}

function actionsSection(model) {
  const buttons = TASK_ACTIONS.map(action => {
    const button = el("button", { type: "button", class: `btn ${action === "take" ? "btn-primary" : "btn-secondary"} btn-sm`, "data-action": action }, [
      icon(ACTION_ICONS[action]), TASK_ACTIONS_TEXT[action].button,
    ]);
    button.addEventListener("click", () => openConfirm(action, model, button));
    return button;
  });
  const children = [el("div", { class: "btn-group task-action-buttons" }, buttons)];
  if (recorded && recorded.id === model.id) children.unshift(recordedNode(recorded.model));
  return section("task-panel-actions", TASK_ACTIONS_TEXT.heading, children);
}

function commandNode(action, id, role) {
  const code = el("code", {}, actionCommand(action, id, { role }).parts.map(p => (p.arg ? el("span", { class: "arg", text: p.text }) : document.createTextNode(p.text))));
  return el("div", { class: "cmd" }, [code]);
}

function fieldNode(name, label, control, hint) {
  const hintId = `task-action-${name}-hint`;
  const errId = `task-action-${name}-error`;
  control.id = `task-action-${name}`;
  control.name = name;
  control.setAttribute("aria-describedby", hint ? hintId : errId);
  const err = el("span", { id: errId, class: "error", hidden: true });
  const wrap = el("div", { class: "field" }, [el("label", { for: control.id, text: label }), control]);
  const hintNode = hint ? el("span", { id: hintId, class: "hint", text: hint }) : null;
  if (hintNode) wrap.append(hintNode);
  wrap.append(err);
  return { wrap, control, err, hintId, errId, hint, hintNode };
}

function setFieldError(field, message) {
  field.control.setAttribute("aria-invalid", message ? "true" : "false");
  field.err.hidden = !message;
  field.err.replaceChildren(...(message ? [icon("alert"), message] : []));
  // An error that says what the hint says replaces it rather than repeating it.
  const hintShown = Boolean(field.hint) && message !== field.hint;
  if (field.hintNode) field.hintNode.hidden = !hintShown;
  field.control.setAttribute("aria-describedby", [hintShown ? field.hintId : null, message ? field.errId : null].filter(Boolean).join(" ") || field.errId);
}

function closeConfirm() {
  if (confirmBox && confirmBox.open) confirmBox.close();
}

function openConfirm(action, model, opener) {
  const text = TASK_ACTIONS_TEXT[action];
  const id = model.id;
  if (!confirmBox) {
    confirmBox = el("dialog", { class: "dialog task-action-dialog", "aria-labelledby": "task-action-title" });
    document.body.append(confirmBox);
  }
  const fields = {};
  if (action === "handoff") fields.role = fieldNode("role", TASK_ACTIONS_TEXT.roleLabel, el("input", { class: "input mono", type: "text", autocomplete: "off", spellcheck: "false", maxlength: "64" }), TASK_ACTIONS_TEXT.roleHint);
  if (action !== "take") fields.reason = fieldNode("reason", TASK_ACTIONS_TEXT.reasonLabel, el("textarea", { class: "textarea", maxlength: "2000" }), text.reasonHint);
  const feedback = el("div", { class: "task-action-feedback" });
  const cmd = el("div", {}, [commandNode(action, id, "")]);
  if (fields.role) fields.role.control.addEventListener("input", () => cmd.replaceChildren(commandNode(action, id, fields.role.control.value)));
  const submit = el("button", { type: "submit", class: "btn btn-primary" }, [icon(ACTION_ICONS[action]), text.submit]);
  const cancel = el("button", { type: "button", class: "btn btn-ghost", text: TASK_ACTIONS_TEXT.cancel });
  cancel.addEventListener("click", closeConfirm);
  const form = el("form", { class: "task-action-form", novalidate: true, "data-draft": "" }, [
    el("div", { class: "dialog-head" }, [
      el("h2", { id: "task-action-title", class: "t-section", text: text.title(id) }),
      model.title && model.title !== id ? el("p", { class: "t-meta", text: model.title }) : null,
    ]),
    el("div", { class: "dialog-body" }, [
      feedback,
      el("p", { class: "t-dense", text: text.explain }),
      ...Object.values(fields).map(f => f.wrap),
      cmd,
      el("p", { class: "t-meta", text: TASK_ACTIONS_TEXT.actorNote }),
    ]),
    el("div", { class: "dialog-foot" }, [cancel, submit]),
  ]);
  form.addEventListener("submit", event => {
    event.preventDefault();
    send(action, id, fields, { form, submit, cancel, feedback });
  });
  confirmBox.replaceChildren(form);
  confirmBox.onclose = () => {
    // Back to the button that opened it, or to the same button redrawn.
    const target = opener.isConnected ? opener : body.querySelector(`button[data-action="${action}"]`);
    const message = body.querySelector(".task-action-recorded");
    (message && confirmBox.dataset.done === "1" ? message : target || title)?.focus();
    confirmBox.dataset.done = "";
  };
  confirmBox.showModal();
  (fields.role || fields.reason)?.control.focus();
  if (action === "take") submit.focus();
}

async function send(action, id, fields, { form, submit, cancel, feedback }) {
  const input = { id };
  for (const [name, field] of Object.entries(fields)) input[name] = field.control.value;
  const checked = validateTaskAction(action, input);
  for (const field of Object.values(fields)) setFieldError(field, null);
  feedback.replaceChildren();
  if (!checked.ok) {
    const field = fields[checked.field];
    if (field) { setFieldError(field, checked.message); field.control.focus(); return; }
    feedback.replaceChildren(failureNode({ state: "error", title: checked.message, detail: "" }));
    return;
  }
  submit.disabled = true;
  cancel.disabled = true;
  form.setAttribute("aria-busy", "true");
  feedback.replaceChildren(el("p", { class: "state state-loading", role: "status", text: TASK_ACTIONS_TEXT.sending }));
  let failure = null;
  let result = null;
  try {
    const res = await fetch(actionPath(action), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Branchling-UI-Capability": capability() },
      body: JSON.stringify(checked.value),
    });
    const json = await res.json().catch(() => null);
    if (res.ok) result = json;
    else failure = taskActionFailure(action, json, res.status);
  } catch (err) {
    failure = { ...unreachableState("task", err.message), action };
  }
  submit.disabled = false;
  cancel.disabled = false;
  form.setAttribute("aria-busy", "false");
  if (failure) {
    const node = failureNode(failure);
    feedback.replaceChildren(node);
    if (failure.state === "rejected" && fields.role) setFieldError(fields.role, failure.title);
    node.focus();
    return;
  }
  // The write invalidated the cache: this read is fresh. The recorded
  // message needs it too, for release's actor (its envelope names none).
  edited = null;
  const answer = await show(id, { reload: true, keepRecorded: true });
  recorded = { id, model: taskActionRecorded(action, result, answer) };
  if (shownId === id) {
    const old = body.querySelector("#task-panel-actions")?.closest("section");
    // A failed re-read still says what was written, above its error.
    if (old && lastModel && lastModel.state === "ready") old.replaceWith(actionsSection(lastModel));
    else body.prepend(recordedNode(recorded.model));
  }
  confirmBox.dataset.done = "1";
  closeConfirm();
}

let lastModel = null;

function render(model, retry) {
  lastModel = model;
  if (model.state === "ready") { renderReady(model); return; }
  if (model.state === "not-found") setHead(model.id, model.title);
  else if (model.state === "loading") setHead(model.id, model.id);
  else setHead(model.id, TASK_TEXT.panelLabel);
  body.replaceChildren(stateBox(model, retry));
}

/* ---------- opening and closing ---------- */

async function show(id, { reload = false, keepRecorded = false, quiet = false } = {}) {
  if (!dialog.open) dialog.showModal();
  if (id === shownId && !reload) { title.focus(); return null; }
  if (!keepRecorded) { recorded = null; edited = null; }
  shownId = id;
  const mine = ++request;
  if (!TASK_ID_SHAPE.test(id)) {
    render(taskNotFound(id));
    title.focus();
    return null;
  }
  body.setAttribute("aria-busy", "true");
  // A live refresh (UI-7) keeps the panel and the focus where they are.
  if (!quiet) {
    render(taskPanelLoading(id));
    title.focus();
  }
  let model;
  let answer = null;
  try {
    const res = await fetch(`/api/task/panel?id=${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } });
    const json = await res.json().catch(() => null);
    if (!res.ok) model = taskPanelFailure(id, json, res.status);
    else {
      answer = json;
      try {
        model = taskPanelModel(json, {
          stale: res.headers.get("x-branchling-ui-stale") === "1",
          fetchedAt: res.headers.get("x-branchling-ui-fetched-at"),
        }, location.search);
        model = { ...model, edits: fieldEdits(json), editsNote: fieldEditsNote(json) };
      } catch (err) {
        model = { ...fromApiError("task", { error: { type: "contract-mismatch", message: err.message } }), id };
      }
    }
  } catch (err) {
    model = { ...unreachableState("task", err.message), id };
  }
  if (mine !== request) return null;
  render(model, () => show(id, { reload: true }));
  body.setAttribute("aria-busy", "false");
  return answer;
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
  recorded = null;
  edited = null;
  closeConfirm();
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

/**
 * Called by live.mjs when the backlog changed (UI-7): the open task is read
 * again in place. Not while an action is being confirmed: that dialog is a
 * form, and live.mjs defers while focus is in one.
 */
export function refresh() {
  if (!dialog || !dialog.open || shownId === null || confirmBox?.open) return null;
  return show(shownId, { reload: true, keepRecorded: true, quiet: true });
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
