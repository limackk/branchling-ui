/**
 * The overview on the page (the default view, `?view=overview` or no `view`
 * at all; UI-29), after docs/design/mockups/overview.html: what needs a
 * person (open questions, failing setup checks, tasks waiting on other
 * tasks) first, then where the backlog stands (the active wave, what is in
 * flight, the totals and the distributions the stats view had).
 *
 * PARTS THAT ANSWER AND FAIL ALONE. The page fetches the existing routes in
 * OVERVIEW_READS in parallel (stats, plan, doctor, decisions, the task list)
 * and rebuilds the model (src/view-model/overview.mjs) as each one answers,
 * so the slow `doctor` never holds the totals back. Every part carries its
 * own state: a part whose read failed shows its error (role="alert", a Try
 * again button that reads only that again) and the others show their data.
 * Text goes in through textContent only.
 *
 * Changed from the mockup: a "needs" card is an <article> with a real link
 * at its foot, not one big link, because it holds links of its own (a task
 * id) and links cannot nest. The "waiting on other tasks" card replaces the
 * mockup's wave card in that row (the task names it among what needs a
 * person); the wave moved to "where the backlog stands".
 *
 * app.mjs imports this module and calls `start()` only when the overview is
 * on screen.
 */

import { OVERVIEW_READS, OVERVIEW_TEXT, overviewModel, overviewPart } from "/view-model/overview.mjs";

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

function icon(name) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `/icons.svg#${name}`);
  svg.append(use);
  return svg;
}

let retry = () => {};

/* ---------- a part's states ---------- */

function loadingNode(part) {
  return el("p", { class: "state state-loading", role: "status", text: part.loadingText || OVERVIEW_TEXT.partLoading });
}

function failureNode(part) {
  const f = part.failure;
  const box = el("div", { class: `state state-${part.state}`, role: "alert" }, [
    el("p", { class: "state-head", text: f.title }),
    el("p", { class: "detail", text: f.detail }),
  ]);
  if (f.refusalKind) box.append(el("p", { text: `Reason code: ${f.refusalKind}` }));
  const again = el("button", { type: "button", text: "Try again" });
  again.addEventListener("click", () => retry(part.source, part.key));
  box.append(again);
  return box;
}

function failedOrLoading(part) {
  if (part.state === "loading") return loadingNode(part);
  if (part.state === "error" || part.state === "refusal") return failureNode(part);
  return null;
}

function moreLink(link) {
  if (!link || !link.label) return null;
  return el("a", { class: "overview-more", href: link.href }, [document.createTextNode(link.label), icon("arrow-right")]);
}

function line(row) {
  const parts = [];
  if (row.id) parts.push(row.href ? el("a", { class: "task-id", href: row.href, text: row.id }) : el("span", { class: "task-id", text: row.id }));
  if (row.label) parts.push(el("strong", { text: row.label }));
  parts.push(el("span", { text: row.text }));
  return el("li", {}, parts);
}

/* ---------- what needs a person ---------- */

function needsCard(part) {
  const id = `overview-${part.key}-heading`;
  const card = el("article", { class: `card card-pad overview-card overview-${part.key}`, "aria-labelledby": id, "data-state": part.state });
  card.append(el("h4", { id, class: "t-overline", text: part.heading }));
  const fallback = failedOrLoading(part);
  if (fallback) {
    card.append(fallback);
    return card;
  }
  card.append(
    el("div", { class: "row" }, [
      part.badge ? el("span", { class: `badge role-${part.badge.role}`, text: part.badge.label }) : null,
      part.meta ? el("span", { class: "t-meta", text: part.meta }) : null,
    ]),
    el("p", { class: "t-title", text: part.title }),
  );
  if (part.lines && part.lines.length) card.append(el("ul", { class: "overview-lines t-meta" }, part.lines.map(line)));
  if (part.more) card.append(el("p", { class: "t-meta", text: part.more }));
  if (part.note) card.append(el("p", { class: "t-caption", text: part.note }));
  card.append(moreLink(part.link));
  return card;
}

/* ---------- where the backlog stands ---------- */

function waveCard(part) {
  return needsCard(part);
}

function inFlightCard(part) {
  const id = "overview-inflight-heading";
  const card = el("section", { class: "card overview-inflight", "aria-labelledby": id, "data-state": part.state }, [
    el("div", { class: "card-head" }, [
      el("h4", { id, text: part.heading }),
      part.note ? el("span", { class: "end t-meta", text: part.note }) : null,
    ]),
  ]);
  const fallback = failedOrLoading(part);
  if (fallback) {
    card.append(el("div", { class: "card-body" }, [fallback]));
    return card;
  }
  if (!part.rows.length) {
    card.append(el("div", { class: "card-body" }, [el("p", { class: "quiet", text: part.title })]));
    return card;
  }
  card.append(el("ul", { class: "tlist" }, part.rows.map(row => el("li", {}, [
    el("span", { class: `badge role-${row.role}`, text: row.statusLabel || "status unknown" }),
    el("span", { class: "overview-task" }, [
      el("a", { class: "task-id", href: row.href, text: row.id }),
      row.title ? el("span", { text: ` ${row.title}` }) : null,
    ]),
    el("span", { class: "meta t-meta" }, [
      row.owner ? el("span", { text: row.owner }) : null,
      row.priority ? el("span", { class: "prio role-neutral", text: row.priority }) : null,
    ]),
  ]))));
  card.append(el("div", { class: "card-foot" }, [moreLink(part.link)]));
  return card;
}

function dist(rows) {
  return el("ul", { class: "dist" }, rows.map(row => {
    const fill = el("span");
    // The CSP forbids style attributes; a computed width goes through element.style.
    fill.style.width = `${row.share}%`;
    fill.style.setProperty("--dot", `var(--role-${row.role}-dot)`);
    return el("li", {}, [
      el("span", {}, [el("span", { class: `badge role-${row.role}`, text: row.label })]),
      el("span", { class: "bar", "aria-hidden": "true" }, [fill]),
      el("a", { class: "n", href: row.href, "aria-label": `${row.count} ${row.label}`, text: String(row.count) }),
    ]);
  }));
}

function totalsBlock(part) {
  const wrap = el("div", { class: "overview-totals", "data-state": part.state });
  const head = el("div", { class: "section-head" }, [
    el("h4", { id: "overview-totals-heading", class: "t-section", text: part.heading }),
    part.source ? el("span", { class: "t-meta", text: part.source }) : null,
  ]);
  wrap.append(head);
  const fallback = failedOrLoading(part);
  if (fallback) {
    wrap.append(fallback);
    return wrap;
  }
  if (part.state === "empty") {
    wrap.append(el("p", { class: "state state-empty", text: part.title }));
    return wrap;
  }
  wrap.append(el("dl", { class: "stats" }, part.tiles.map(t => el("div", { class: "stat" }, [
    el("dt", { text: t.label }),
    el("dd", { class: "t-stat" }, [document.createTextNode(t.value), t.unit ? el("span", { class: "t-meta", text: ` ${t.unit}` }) : null]),
    t.note ? el("dd", { class: "delta", text: t.note }) : null,
  ]))));
  const byStatus = el("section", { class: "card", "aria-labelledby": "overview-by-status" }, [
    el("div", { class: "card-head" }, [
      el("h5", { id: "overview-by-status", text: OVERVIEW_TEXT.byStatus }),
      el("a", { class: "end t-meta overview-all", href: part.link.href, text: part.link.label }),
    ]),
    el("div", { class: "card-body" }, [dist(part.byStatus)]),
  ]);
  const byPriority = part.byPriority.length
    ? el("section", { class: "card", "aria-labelledby": "overview-by-priority" }, [
      el("div", { class: "card-head" }, [el("h5", { id: "overview-by-priority", text: OVERVIEW_TEXT.byPriority })]),
      el("div", { class: "card-body" }, [dist(part.byPriority)]),
    ])
    : null;
  wrap.append(el("div", { class: "grid grid-2 overview-dists" }, [byStatus, byPriority]));
  return wrap;
}

/* ---------- the page ---------- */

/*
 * The page is drawn once as a frame of slots, and each answer replaces only
 * the parts whose model changed, so keyboard focus inside a part that is
 * already shown is never thrown away by another part arriving.
 */
const BUILD = {
  questions: needsCard, checks: needsCard, blocked: needsCard,
  wave: waveCard, inFlight: inFlightCard, totals: totalsBlock,
};

function frame(target) {
  const slots = {};
  const slot = key => (slots[key] = el("div", { class: `overview-slot overview-slot-${key}` }));
  target.replaceChildren(
    slot("stale"),
    el("section", { class: "overview-needs", "aria-labelledby": "overview-needs-heading" }, [
      el("h3", { id: "overview-needs-heading", class: "visually-hidden", text: OVERVIEW_TEXT.needsTitle }),
      el("div", { class: "grid grid-3" }, [slot("questions"), slot("checks"), slot("blocked")]),
    ]),
    el("section", { class: "overview-stands", "aria-labelledby": "overview-stands-heading" }, [
      el("h3", { id: "overview-stands-heading", text: OVERVIEW_TEXT.standsTitle }),
      el("div", { class: "grid grid-2" }, [slot("wave"), slot("inFlight")]),
      slot("totals"),
    ]),
  );
  return { slots, drawn: {} };
}

/** Draws what changed; returns the keys of the parts redrawn. */
function render(view, model) {
  const redrawn = [];
  const stale = model.freshness && model.freshness.stale ? "stale" : "fresh";
  if (view.drawn.stale !== stale) {
    view.slots.stale.replaceChildren(...(stale === "stale" ? [el("p", { class: "state state-stale", role: "status", text: OVERVIEW_TEXT.stale })] : []));
    view.drawn.stale = stale;
  }
  for (const part of [...model.needs, model.wave, model.inFlight, model.totals]) {
    const json = JSON.stringify(part);
    if (view.drawn[part.key] === json) continue;
    view.slots[part.key].replaceChildren(BUILD[part.key](part));
    view.drawn[part.key] = json;
    redrawn.push(part.key);
  }
  return redrawn;
}

async function read(path) {
  try {
    const res = await fetch(path, { headers: { Accept: "application/json" } });
    const body = await res.json().catch(() => null);
    // doctor is never cached, so no fetched-at header comes with it: an
    // uncached read answered just now.
    const fetchedAt = res.headers.get("x-branchling-ui-fetched-at") || new Date().toISOString();
    return { ok: res.ok, status: res.status, body, fetchedAt, stale: res.headers.get("x-branchling-ui-stale") === "1" };
  } catch (err) {
    return { ok: false, unreachable: true, message: err.message };
  }
}

export function start(section) {
  document.title = "Backlog overview";
  const target = section.querySelector("#overview");
  const view = frame(target);
  /** The part whose Try again was pressed: focus returns to it once it is redrawn. */
  let focusKey = null;
  section.querySelector("#overview-title")?.after(el("p", { class: "lede overview-lede", text: OVERVIEW_TEXT.lede }));
  /** read name -> its part, and the time and staleness of its answer */
  const parts = {};
  const times = {};
  let pending = 0;

  function draw() {
    const known = Object.values(times).filter(t => t.fetchedAt);
    const fetchedAt = known.length ? known.map(t => t.fetchedAt).sort()[0] : null;
    const stale = Object.values(times).some(t => t.stale);
    const model = overviewModel(parts, { stale, fetchedAt }, Date.now());
    if (model.root) document.getElementById("root").textContent = model.root;
    const redrawn = render(view, model);
    if (focusKey && redrawn.includes(focusKey)) {
      // The pressed button is gone with the redraw: focus stays on its part.
      const node = view.slots[focusKey].firstElementChild;
      if (node) { node.setAttribute("tabindex", "-1"); node.focus(); }
      const part = [...model.needs, model.wave, model.inFlight, model.totals].find(p => p.key === focusKey);
      if (!part || part.state !== "loading") focusKey = null;
    }
    target.setAttribute("aria-busy", pending > 0 ? "true" : "false");
  }

  async function load(name, { quiet = false } = {}) {
    pending++;
    target.setAttribute("aria-busy", "true");
    // Try again: a failed part goes back to loading until its read answers.
    // A live refresh (UI-7) keeps the part on screen until the new answer is in.
    if (!quiet) {
      delete parts[name];
      delete times[name];
    }
    const answer = await read(OVERVIEW_READS[name]);
    parts[name] = overviewPart(answer);
    times[name] = { fetchedAt: answer.ok ? answer.fetchedAt : null, stale: answer.ok && answer.stale };
    pending--;
    draw();
  }

  retry = (name, key = null) => {
    focusKey = key;
    const names = Object.hasOwn(OVERVIEW_READS, name) ? [name] : Object.keys(OVERVIEW_READS);
    for (const n of names) delete parts[n];
    draw();
    for (const n of names) load(n);
  };
  reload = () => Promise.all(Object.keys(OVERVIEW_READS).map(n => load(n, { quiet: true })));
  retry(null);
}

/** Set by start(); live.mjs calls refresh() when the backlog changed (UI-7). */
let reload = null;
export const refresh = () => reload?.();
