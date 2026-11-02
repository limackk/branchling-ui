/**
 * The health view on the page (`?view=health`, UI-28), after
 * docs/design/mockups/health.html: the setup checks (`doctor`), the release
 * gate (`check`) and the tasks other branches disagree with (`stats`
 * `divergent`), each in its own section that renders as soon as its own read
 * answers, so the slow `doctor` (about 1.4 s) never holds the others back.
 * Text goes in through textContent only, and branchling's sentences are shown
 * as it wrote them.
 *
 * Rejected from the mockup: the tab bar. Three short sections fit one page,
 * a failing guard should not hide behind a tab, and tabs would promise arrow
 * key panels the rest of the app does not have. Rejected too: tables. A
 * guard's output is several lines of prose; a list item per check keeps it
 * readable at 375 px with nothing to fold.
 *
 * THE NAV BADGE. The Health link shows the number of failing checks only
 * once this view has read them, that is on this screen. Fetching `doctor`
 * and `check` on every page load just for a badge would add about 2 s of
 * spawns to every other view; a remembered count from an earlier visit would
 * be an unmarked stale number. Neither is done (docs/architecture.md).
 *
 * "Run again" keeps the last results on screen, marked stale, until the new
 * ones answer: exactly the architecture's stale state.
 *
 * app.mjs imports this module and calls `start()` only when `?view=health` is
 * on screen.
 */

import { checkModel, divergentModel, doctorModel, healthSummary, HEALTH_TEXT } from "/view-model/health.mjs";
import { fromApiError, unreachableState } from "/view-model/states.mjs";

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

async function getJson(path) {
  try {
    const res = await fetch(path, { headers: { Accept: "application/json" } });
    const body = await res.json().catch(() => null);
    // doctor and check are not cached (src/cache.mjs), so no fetched-at
    // header comes with them: an uncached read answered just now.
    const fetchedAt = res.headers.get("x-branchling-ui-fetched-at") || new Date().toISOString();
    return { ok: res.ok, status: res.status, body, fetchedAt, stale: res.headers.get("x-branchling-ui-stale") === "1" };
  } catch (err) {
    return { ok: false, unreachable: true, message: err.message };
  }
}

function failureNode(model, retry) {
  const box = el("div", { class: `state state-${model.state}`, role: "alert" }, [
    el("h4", { text: model.title }),
    el("p", { class: "detail", text: model.detail }),
  ]);
  if (model.refusalKind) box.append(el("p", { text: `Reason code: ${model.refusalKind}` }));
  const again = el("button", { type: "button", text: "Try again" });
  again.addEventListener("click", retry);
  box.append(again);
  return box;
}

function resultPill(row) {
  return el("span", { class: `badge role-${row.role} health-result`, text: row.resultLabel });
}

function ranAt(model) {
  if (!model.freshness.fetchedAt) return null;
  const at = new Date(model.freshness.fetchedAt);
  return el("time", { datetime: model.freshness.fetchedAt, text: at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
}

/* ---------- the three sections ---------- */

function renderDoctor(model) {
  const parts = [];
  if (!model.backlogFound) parts.push(el("p", { class: "quiet", text: "branchling found no backlog where it looked." }));
  if (model.state === "empty") parts.push(el("p", { class: "quiet", text: HEALTH_TEXT.doctorEmpty }));
  else {
    parts.push(el("ul", { class: "tlist health-list" }, model.checks.map(row => el("li", { "data-result": row.result }, [
      resultPill(row),
      el("span", { class: "health-name", text: row.title }),
      el("div", { class: "health-detail" }, [
        row.detail ? el("p", { text: row.detail }) : null,
        row.fix ? el("p", { class: "t-meta" }, [document.createTextNode(`${HEALTH_TEXT.fix}: `), el("code", { text: row.fix })]) : null,
      ]),
    ]))));
  }
  if (model.next) {
    parts.push(el("p", { class: "health-next t-meta" }, [document.createTextNode(`${HEALTH_TEXT.next}: `), el("code", { text: model.next })]));
  }
  return parts;
}

function renderCheck(model) {
  if (model.state === "empty") return [el("p", { class: "quiet", text: HEALTH_TEXT.checkEmpty })];
  return [el("ul", { class: "tlist health-list" }, model.guards.map(row => el("li", { "data-result": row.result }, [
    resultPill(row),
    el("span", { class: "health-name" }, [el("code", { text: row.name })]),
    el("div", { class: "health-detail" }, [
      el("pre", { class: "health-output", text: row.output }),
      row.severity ? el("p", { class: "t-meta", text: `${HEALTH_TEXT.severity}: ${row.severity}` }) : null,
    ]),
  ])))];
}

function renderDivergent(model) {
  if (model.scanned === false) {
    return [el("p", { class: "quiet", text: model.scanReason ? `${HEALTH_TEXT.divergentNotScanned} ${model.scanReason}` : HEALTH_TEXT.divergentNotScanned })];
  }
  if (model.state === "empty") return [el("p", { class: "quiet", text: HEALTH_TEXT.divergentEmpty })];
  return [el("ul", { class: "tlist health-list" }, model.tasks.map(task => el("li", {}, [
    el("span", { class: "task-id", text: task.id }),
    el("span", { class: "health-name" }, [
      document.createTextNode("here: "),
      el("span", { class: "role role-neutral", text: task.status || "—" }),
    ]),
    el("ul", { class: "health-elsewhere t-meta" }, task.elsewhere.map(o => el("li", {}, [icon("branch"), el("code", { text: o.text })]))),
  ])))];
}

const SECTIONS = [
  { key: "doctor", path: "/api/health/doctor", title: HEALTH_TEXT.doctorTitle, command: HEALTH_TEXT.doctorCommand, loading: HEALTH_TEXT.doctorLoading, build: doctorModel, render: renderDoctor },
  { key: "check", path: "/api/health/check", title: HEALTH_TEXT.checkTitle, command: HEALTH_TEXT.checkCommand, loading: HEALTH_TEXT.checkLoading, build: checkModel, render: renderCheck },
  { key: "divergent", path: "/api/health/divergent", title: HEALTH_TEXT.divergentTitle, command: HEALTH_TEXT.divergentCommand, loading: HEALTH_TEXT.divergentLoading, build: divergentModel, render: renderDivergent },
];

/* ---------- the nav badge ---------- */

function setBadge(summary) {
  const link = document.querySelector('[data-view-link="health"]');
  if (!link) return;
  link.querySelector(".count")?.remove();
  if (!summary.badge) return;
  link.append(el("span", { class: `count badge plain role-${summary.badge.role}` }, [
    el("span", { class: "visually-hidden", text: ", " }),
    document.createTextNode(String(summary.badge.count)),
    el("span", { class: "visually-hidden", text: ` ${HEALTH_TEXT.badgeLabel}` }),
  ]));
}

/* ---------- wiring ---------- */

export function start(section) {
  document.title = "Backlog health";
  const target = section.querySelector("#health");
  const headline = el("p", { class: "health-headline", role: "status" });
  const again = el("button", { type: "button", class: "btn btn-secondary" }, [icon("refresh"), document.createTextNode(HEALTH_TEXT.runAgain)]);
  const head = el("div", { class: "page-head health-head" }, [
    el("p", { class: "lede", text: HEALTH_TEXT.lede }),
    el("div", { class: "actions" }, [again]),
  ]);

  /** The latest model of each section, and the envelope of its latest answer. */
  const models = { doctor: null, check: null, divergent: null };
  const envelopes = { doctor: null, check: null, divergent: null };
  const parts = {};
  for (const s of SECTIONS) {
    const id = `health-${s.key}-title`;
    const meta = el("span", { class: "end t-meta" });
    const body = el("div", { class: "card-body", "aria-live": "polite", "aria-busy": "true" });
    parts[s.key] = { meta, body };
    target.append(el("section", { class: "card health-section", "aria-labelledby": id }, [
      el("div", { class: "card-head" }, [el("h3", { id, text: s.title }), meta]),
      body,
    ]));
  }
  target.before(head, headline);

  function updateSummary() {
    const summary = healthSummary({ doctor: models.doctor, check: models.check });
    headline.textContent = summary.headline || "";
    headline.hidden = !summary.headline;
    setBadge(summary);
  }

  function show(s, model) {
    const { meta, body } = parts[s.key];
    const ok = model.state === "ready" || model.state === "empty";
    const time = ok ? ranAt(model) : null;
    meta.replaceChildren(
      el("code", { text: s.command }),
      ...(ok && model.summary ? [document.createTextNode(` \u00b7 ${model.summary}`)] : []),
      ...(time ? [document.createTextNode(" \u00b7 ran "), time] : []),
    );
    if (!ok) body.replaceChildren(failureNode(model, () => loadOne(s)));
    else body.replaceChildren(...(model.freshness.stale ? [el("p", { class: "state state-stale", role: "status", text: HEALTH_TEXT.stale })] : []), ...s.render(model));
  }

  async function loadOne(s) {
    const { body } = parts[s.key];
    body.setAttribute("aria-busy", "true");
    if (envelopes[s.key]) {
      // Run again: the last answer stays, marked stale, until the new one is in.
      show(s, s.build(envelopes[s.key], { stale: true, fetchedAt: models[s.key]?.freshness?.fetchedAt ?? null }));
    } else {
      body.replaceChildren(el("p", { class: "state state-loading", role: "status", text: s.loading }));
    }
    const answer = await getJson(s.path);
    let model;
    if (!answer.ok) model = answer.unreachable ? unreachableState(s.key, answer.message) : fromApiError(s.key, answer.body, answer.status);
    else {
      try {
        model = s.build(answer.body, { stale: answer.stale, fetchedAt: answer.fetchedAt });
        envelopes[s.key] = answer.body;
      } catch (err) {
        model = fromApiError(s.key, { error: { type: "contract-mismatch", message: err.message } });
      }
    }
    // A failed run forgets the last answer: an error is never shown beside an old verdict.
    if (model.state !== "ready" && model.state !== "empty") envelopes[s.key] = null;
    models[s.key] = model;
    show(s, model);
    body.setAttribute("aria-busy", "false");
    if (s.key === "doctor" && model.root) document.getElementById("root").textContent = model.root;
    updateSummary();
  }

  function loadAll() {
    again.setAttribute("aria-busy", "true");
    Promise.all(SECTIONS.map(loadOne)).finally(() => again.setAttribute("aria-busy", "false"));
  }

  again.addEventListener("click", loadAll);
  updateSummary();
  loadAll();
}
