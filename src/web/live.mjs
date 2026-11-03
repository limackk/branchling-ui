/**
 * Live refresh on the page (UI-7). Opens one EventSource on /api/events and,
 * when the backlog changes, asks the modules on screen to re-read: the current
 * view and the task panel, each through its optional `refresh()` export. A
 * module without one (health: `check` runs the release gate's guards, a cost
 * spent on request with "Run again", not on every save in an editor) is left
 * alone.
 *
 *   change        a task changed: refresh, debounced by DEBOUNCE_MS, so a
 *                 burst (a `seed`, a checkout) is one re-read
 *   connected     the stream is armed. Refresh when the server says a change
 *                 may have been missed (`resync`), or when this page's own
 *                 connection had dropped: events sent meanwhile never came
 *   disconnected  the server's `follow` child is down: show the notice
 *
 * NEVER UNDER THE USER'S HANDS. A refresh redraws, and a redraw would throw
 * away an answer being typed or reset a field being edited. So it is deferred
 * while focus is inside any form, and while a form marked `data-draft` (a
 * decision's answer, a task action's reason, the release planning forms) has had input since it was last
 * submitted and is still on the page. A deferred refresh says so in the
 * notice, with a button to refresh anyway, and runs when focus leaves the form
 * or the form is submitted. Filter forms (tasks, release) are not drafts:
 * what they hold is already in the URL.
 */

import { liveNotice } from "/view-model/live.mjs";

export const DEBOUNCE_MS = 250;
const SVG = "http://www.w3.org/2000/svg";

function icon(name) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `/icons.svg#${name}`);
  svg.append(use);
  return svg;
}

/** @param {Promise<object>[]} modules the view module and the task panel module, once started */
export function start(modules) {
  const drafts = new Set();
  let connection = "unknown";
  let dropped = false;
  let deferred = false;
  let timer = null;

  // Always in the page, empty while there is nothing to say, so that a
  // notice put into it is announced (a region that appears with its text is not).
  const region = document.createElement("div");
  region.className = "live-status";
  region.setAttribute("role", "status");
  document.getElementById("main")?.prepend(region);

  function draw() {
    const notice = liveNotice({ connection, deferred });
    if (!notice) { region.replaceChildren(); return; }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-secondary btn-sm";
    button.textContent = notice.action;
    button.addEventListener("click", () => run(true));
    const text = document.createElement("span");
    text.textContent = notice.text;
    const end = document.createElement("span");
    end.className = "end";
    end.append(button);
    const banner = document.createElement("div");
    banner.className = `banner state-${notice.tone}`;
    banner.append(icon(notice.icon), text, end);
    region.replaceChildren(banner);
  }

  function busy() {
    for (const form of drafts) if (!form.isConnected) drafts.delete(form);
    if (drafts.size) return true;
    const active = document.activeElement;
    return Boolean(active && active.closest && active.closest("form"));
  }

  async function run(force = false) {
    clearTimeout(timer);
    timer = null;
    if (!force && busy()) {
      if (!deferred) { deferred = true; draw(); }
      return;
    }
    if (force) drafts.clear();
    if (deferred) { deferred = false; draw(); }
    const focused = whereFocusIs();
    const loaded = await Promise.all(modules.map(p => p.catch(() => null)));
    await Promise.all(loaded.map(m => (m && typeof m.refresh === "function" ? Promise.resolve(m.refresh()).catch(() => null) : null)));
    restoreFocus(focused);
  }

  /** What has focus, described well enough to find its redrawn twin. */
  function whereFocusIs() {
    const node = document.activeElement;
    if (!node || node === document.body || node === document.documentElement) return null;
    return { node, id: node.id, task: node.dataset?.task, cls: node.className, tag: node.tagName, text: node.textContent, dialog: node.closest("dialog[open]") };
  }

  /**
   * A redraw replaces nodes, and focus on a replaced node falls to <body>,
   * which sends a keyboard user back to the top. Put it on the same control
   * as redrawn (same id; same task link; same tag and text), else on the
   * region that holds the view.
   */
  function restoreFocus(was) {
    if (!was || was.node.isConnected) return;
    const active = document.activeElement;
    if (active && active !== document.body) return; // something else took it on purpose
    const esc = s => CSS.escape(s);
    const twin = (was.id && document.getElementById(was.id))
      || (was.task && [...document.querySelectorAll(`a[data-task="${esc(was.task)}"]`)].find(n => n.className === was.cls))
      || [...document.querySelectorAll(was.tag)].find(n => n.textContent === was.text && n.className === was.cls)
      || (was.dialog?.open ? was.dialog.querySelector('[tabindex="-1"]') || was.dialog : null)
      || document.getElementById("main");
    twin?.focus({ preventScroll: true });
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  }

  document.addEventListener("input", event => {
    const form = event.target instanceof Element ? event.target.closest("form[data-draft]") : null;
    if (form) drafts.add(form);
  });
  document.addEventListener("submit", event => {
    drafts.delete(event.target);
    if (deferred) setTimeout(run, 0);
  });
  document.addEventListener("focusout", () => {
    // Where focus went is known only after the event.
    if (deferred) setTimeout(run, 0);
  });

  function setConnection(next) {
    if (connection === next) return;
    connection = next;
    draw();
  }

  const data = event => { try { return JSON.parse(event.data); } catch { return {}; } };
  const source = new EventSource("/api/events");
  source.addEventListener("connected", event => {
    const missed = data(event).resync === true || dropped;
    dropped = false;
    setConnection("live");
    if (missed) schedule();
  });
  source.addEventListener("disconnected", () => {
    dropped = true;
    setConnection("down");
  });
  source.addEventListener("change", schedule);
  // The browser reconnects by itself (the server sends `retry:`); until a
  // `connected` arrives, this page may be missing events.
  source.addEventListener("error", () => {
    dropped = true;
    setConnection("down");
  });
}
