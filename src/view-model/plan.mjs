/**
 * The plan view model: plain data computed from a `plan` envelope (and,
 * optionally, a `task-list` envelope for titles and dependencies). The task
 * panel opened over the plan is the shared one, src/view-model/task.mjs (UI-27).
 *
 * Pure and portable like stats.mjs: no `node:` import, no DOM, no HTML, no
 * ANSI, no I/O. Both surfaces render THIS.
 *
 * WHERE EVERY ANSWER COMES FROM. Each one is a key branchling computed in
 * `plan --json`, never derived here from status names. The `vocabulary`
 * envelope (UI-18) now names each status's role and the archived set, and it
 * is still not used for these: it gives colour and order (roles.mjs), while
 * open, closed and in flight are branchling's own answer over the same
 * configuration, and a second derivation here could only disagree with it:
 *
 *   active wave      `activeWave` (an index) and `waves[i].active`: the first
 *                    wave holding an open task. `null` with waves present means
 *                    every wave is closed.
 *   may start now    `nextUp`: the active wave's open tasks whose blockers are
 *                    all closed, a `together` group as one entry. branchling
 *                    counts a task in flight as open, so an entry whose ids are
 *                    in `inProgress` is shown as in flight, not as startable.
 *   in flight        `inProgress`: every plan task in flight, in any wave.
 *   unplanned        `unplanned` (open tasks no wave schedules) and `coverage`
 *                    (`open`, `planned`, `unplanned`, `share` in percent).
 *   overtaken        `stale`: plan tasks already closed in a wave after the
 *                    active one.
 *   wave state       closed (`open` is 0), active (`active`), next (the wave
 *                    right after the active one), later (the rest). Order is
 *                    the plan's order and is never re-sorted.
 *   open / closed    per task, `waves[].tasks[].open`; per wave, `open` and
 *                    `closed`.
 *
 * TITLES AND EDGES. Since TL-534 each wave task carries `title` and
 * `blocked_by`, closed tasks included, and those win. The optional `task-list`
 * envelope (`query --json`, active tasks only) is still read: it is where an
 * UNPLANNED task's title and edges come from, and the only source on a
 * branchling that predates TL-534 (0.3.0), where a closed planned task shows
 * its id alone. `dependenciesKnown` says whether that list was read; with no
 * list the model says so instead of drawing no edges as if there were none.
 * Absent and therefore not shown: the critical path, elapsed time against
 * estimate, the actor and the worktree of a running task.
 *
 * A BROKEN PLAN IS A REFUSAL (TL-534, UI-22). `plan --json` answers a plan it
 * cannot read or execute with `ok: false`, a `refusalKind`
 * (`plan-unparsable`, `plan-contradicts-blocked-by`, `plan-contradicts-tree`),
 * branchling's own sentence in `refusal` and every defect in `problems`, and
 * exits 1, so the adapter throws it as a BranchlingRefusal carrying that
 * envelope. `planModel` turns it into the `refusal` state with the problems
 * listed, never into `empty`: its `waves` is `[]`, and an unreadable plan
 * drawn as "schedules no waves yet" reads exactly like a real answer.
 */

import { statusRole } from "./roles.mjs";

const label = key => String(key).replace(/_/g, " ");

/**
 * The headings and sentences of the plan view, decided once so every surface
 * says the same thing: the web page (src/web/plan.mjs) and the terminal
 * interface both render them from here and carry no copies of their own.
 */
export const PLAN_TEXT = {
  title: "Plan",
  loading: "Loading the plan…",
  stale: "Showing the last known plan; a fresh read is on its way.",
  emptyNoPlan: "This backlog has no execution plan. That is fine: the order is an optional decision.",
  emptyNoWaves: "The plan exists but schedules no waves yet.",
  // A placeholder in a command is a bare upper-case word (ID, NAME), as in DECISIONS_TEXT's YOUR ANSWER: no `<`, which the model forbids, and it reads the same in a browser and a terminal.
  emptyHint: "A plan is plan.yaml next to the tasks: an ordered list of waves, each a named batch of task ids. Once it has a wave, `branchling plan add ID --wave \"NAME\"` schedules more.",
  asOf: "As of",
  rationale: "Why this order",
  dependenciesUnknown: "Titles and dependencies could not be read; tasks are shown by id.",
  inFlight: "In flight",
  noneInFlight: "Nothing in the plan is in flight.",
  mayStartNow: "May start now",
  noneStartable: "Nothing in the active wave may start now.",
  finished: "Every wave is closed; the plan is finished.",
  together: "Done as one",
  waitsOnHuman: "waits on a person",
  waves: "Waves",
  wave: "Wave",
  endsOnHuman: "This wave ends on a person: an unattended run cannot close it on its own.",
  noTasksInWave: "This wave schedules no tasks.",
  overtaken: "Overtaken",
  overtakenNote: "Closed in a wave after the active one: the order may want reshuffling.",
  unplanned: "Unplanned",
  allPlanned: "Every open task is in the plan.",
  footnote: "The plan orders; it does not block. Status stays the only truth about what has happened.",
};

/**
 * The sentences of a broken plan (UI-22). Kept apart from PLAN_TEXT because
 * no surface renders them by key: they reach both through the refusal
 * state's `title` and `hint`, which the shared state rendering draws. One
 * heading per refusalKind branchling names, so the reader learns WHAT is
 * wrong before reading the problems themselves.
 */
export const PLAN_REFUSAL_TEXT = {
  titles: {
    "plan-unparsable": "The plan does not parse",
    "plan-contradicts-blocked-by": "The plan contradicts blocked_by",
    "plan-contradicts-tree": "The plan names tasks the backlog does not hold as it says",
  },
  other: "branchling refused to read the plan",
  hint: "No wave is shown because branchling would not read this plan: it is not empty, it is broken. Fix plan.yaml, or reorder it with `branchling plan move ID --wave \"NAME\"`, then refresh.",
};

/**
 * A `plan` envelope that branchling refused (`ok: false` or a `refusalKind`):
 * the shared `refusal` state, with the plan's own heading for the kind and
 * every problem branchling listed (each one carries its line number or its
 * task ids), so both surfaces can show WHAT to fix.
 *
 * @param {object} envelope the `plan` envelope of the refusal, as the adapter's
 *   BranchlingRefusal (`err.envelope`) or the server's 409 body carries it
 * @param {{ stale?: boolean, fetchedAt?: string|null }} [freshness]
 */
export function planRefusalState(envelope, freshness = {}) {
  if (!envelope || envelope.kind !== "plan") throw new TypeError("planRefusalState needs a plan envelope");
  const refusalKind = typeof envelope.refusalKind === "string" && envelope.refusalKind ? envelope.refusalKind : null;
  const sentence = typeof envelope.refusal === "string" && envelope.refusal.trim() ? envelope.refusal.trim() : null;
  return {
    view: "plan",
    state: "refusal",
    freshness: freshnessOf(freshness),
    root: typeof envelope.root === "string" ? envelope.root : null,
    title: (refusalKind && Object.hasOwn(PLAN_REFUSAL_TEXT.titles, refusalKind) ? PLAN_REFUSAL_TEXT.titles[refusalKind] : null) ?? PLAN_REFUSAL_TEXT.other,
    detail: sentence ?? "No detail was given.",
    details: Array.isArray(envelope.problems) ? envelope.problems.filter(p => typeof p === "string" && p).map(String) : [],
    hint: PLAN_REFUSAL_TEXT.hint,
    refusalKind,
  };
}

/** Whether a `plan` envelope is branchling refusing the plan rather than answering it. */
export function isPlanRefusal(envelope) {
  return !!envelope && envelope.kind === "plan" && (envelope.ok === false || (typeof envelope.refusalKind === "string" && envelope.refusalKind !== ""));
}

function edgeText(edge) {
  if (edge.open === true) return `waits on ${edge.id}`;
  if (edge.open === false) return `after ${edge.id} (closed)`;
  return `after ${edge.id}`;
}

/**
 * What a task row says besides its id, title and status, in the order the web
 * page shows it: in flight, overtaken, not in this backlog, each edge, what it
 * unblocks. A surface adds where it is listed (`wave N`) itself.
 */
export function taskNotes(task) {
  const notes = [];
  if (task.inFlight) notes.push("in flight");
  if (task.overtaken) notes.push("overtaken");
  if (task.known === false) notes.push("not in this backlog");
  for (const edge of task.waitsOn || []) notes.push(edgeText(edge));
  if (task.unblocks && task.unblocks.length) notes.push(`unblocks ${task.unblocks.join(", ")}`);
  return notes;
}

function freshnessOf(freshness = {}) {
  return { stale: freshness.stale === true, fetchedAt: freshness.fetchedAt ?? null };
}

function waveState(wave, activeWave) {
  if (wave.active === true) return "active";
  if (Number(wave.open) === 0) return "closed";
  if (activeWave !== null && wave.index === activeWave + 1) return "next";
  return "later";
}

const WAVE_STATE_LABELS = { closed: "closed", active: "active", next: "next", later: "later" };

/**
 * @param {object} envelope a `plan` envelope from adapter.plan()
 * @param {{ stale?: boolean, fetchedAt?: string|null }} [freshness]
 * @param {object|null} [taskList] a `task-list` envelope from adapter.query(),
 *   for titles and blocked_by; null when it is not available
 */
export function planModel(envelope, freshness = {}, taskList = null) {
  // Before the shape check: a refusal's `waves` is `[]`, which would otherwise
  // pass it and build the empty state.
  if (isPlanRefusal(envelope)) return planRefusalState(envelope, freshness);
  if (!envelope || envelope.kind !== "plan" || !Array.isArray(envelope.waves)) {
    throw new TypeError("planModel needs a plan envelope");
  }
  if (taskList !== null && (!taskList || taskList.kind !== "task-list" || !Array.isArray(taskList.tasks))) {
    throw new TypeError("planModel's task list must be a task-list envelope or null");
  }

  const base = {
    view: "plan",
    freshness: freshnessOf(freshness),
    root: typeof envelope.root === "string" ? envelope.root : null,
    planExists: envelope.exists === true,
    rationale: typeof envelope.rationale === "string" && envelope.rationale ? envelope.rationale : null,
    updated: typeof envelope.updated === "string" && envelope.updated ? envelope.updated : null,
  };

  const coverage = envelope.coverage && typeof envelope.coverage === "object"
    ? {
      open: Number(envelope.coverage.open) || 0,
      planned: Number(envelope.coverage.planned) || 0,
      unplanned: Number(envelope.coverage.unplanned) || 0,
      share: Number(envelope.coverage.share) || 0,
    }
    : null;

  const listed = new Map((taskList?.tasks || []).map(t => [t.id, t]));
  const planOpen = new Map();
  // Title and edges per task: the plan's own (TL-534) where a wave task
  // carries them, the task list's otherwise (an unplanned task, or a
  // branchling whose plan envelope has neither).
  const known = new Map();
  for (const wave of envelope.waves) {
    for (const t of wave.tasks || []) {
      planOpen.set(t.id, t.open === true);
      const fromList = listed.get(t.id);
      known.set(t.id, {
        title: typeof t.title === "string" && t.title ? t.title : fromList?.title,
        blocked_by: Array.isArray(t.blocked_by) ? t.blocked_by : fromList?.blocked_by,
      });
    }
  }
  for (const [id, t] of listed) if (!known.has(id)) known.set(id, t);
  const unplannedIds = new Set((envelope.unplanned || []).map(t => t.id));
  const inFlightIds = new Set((envelope.inProgress || []).map(t => t.id));
  const overtakenIds = new Set((envelope.stale || []).map(t => t.id));

  // Reverse edges: who waits on each id, from every task whose edges are known.
  const unblocks = new Map();
  for (const [id, t] of known) {
    for (const blocker of t.blocked_by || []) {
      if (!unblocks.has(blocker)) unblocks.set(blocker, []);
      unblocks.get(blocker).push(id);
    }
  }

  /** Open as branchling reported it: in a wave, or listed as unplanned (open). */
  const openOf = id => (planOpen.has(id) ? planOpen.get(id) : unplannedIds.has(id) ? true : null);

  function taskRow(id, status, extra = {}) {
    const task = known.get(id);
    const row = {
      id,
      title: task && typeof task.title === "string" ? task.title : null,
      status: typeof status === "string" ? status : null,
      statusLabel: typeof status === "string" ? label(status) : null,
      role: statusRole(status),
      open: openOf(id),
      inFlight: inFlightIds.has(id),
      overtaken: overtakenIds.has(id),
      waitsOn: (task?.blocked_by || []).map(b => ({ id: b, open: openOf(b) })),
      unblocks: [...(unblocks.get(id) || [])],
      ...extra,
    };
    row.notes = taskNotes(row);
    return row;
  }

  const waveName = index => {
    const wave = envelope.waves.find(w => w.index === index);
    return wave ? wave.name : null;
  };

  const activeWave = Number.isInteger(envelope.activeWave) ? envelope.activeWave : null;
  const waves = envelope.waves.map(wave => {
    const state = waveState(wave, activeWave);
    const open = Number(wave.open) || 0;
    const closed = Number(wave.closed) || 0;
    return {
      index: wave.index,
      number: wave.index + 1,
      name: String(wave.name),
      state,
      stateLabel: WAVE_STATE_LABELS[state],
      active: state === "active",
      // Finished work collapses by default; live and future work does not.
      collapsed: state === "closed",
      open,
      closed,
      total: open + closed,
      progressLabel: `${closed} of ${open + closed} closed`,
      endsOnHuman: wave.endsOnHuman === true,
      groups: (wave.together || []).map(group => [...group]),
      tasks: (wave.tasks || []).map(t => taskRow(t.id, t.status, {
        known: t.known !== false,
        executor: t.executor || null,
        together: (wave.together || []).some(group => group.includes(t.id)),
      })),
    };
  });

  const mayStartNow = [];
  const inFlightNext = [];
  for (const entry of envelope.nextUp || []) {
    const item = {
      together: entry.together === true,
      ids: [...entry.ids],
      waitsOnHuman: entry.waitsOnHuman === true,
      executors: [...(entry.executors || [])],
    };
    (entry.ids.some(id => inFlightIds.has(id)) ? inFlightNext : mayStartNow).push(item);
  }

  const statusIn = id => {
    for (const wave of envelope.waves) for (const t of wave.tasks || []) if (t.id === id) return t.status;
    return null;
  };
  for (const item of mayStartNow) item.tasks = item.ids.map(id => taskRow(id, statusIn(id)));

  const inFlight = (envelope.inProgress || []).map(t => taskRow(t.id, t.status, { wave: t.wave, waveNumber: t.wave + 1, waveName: waveName(t.wave) }));
  const overtaken = (envelope.stale || []).map(t => taskRow(t.id, t.status, { wave: t.wave, waveNumber: t.wave + 1, waveName: waveName(t.wave) }));
  const unplannedRows = (envelope.unplanned || []).map(t => taskRow(t.id, t.status));

  const plannedClosed = waves.reduce((n, w) => n + w.closed, 0);
  const plannedTotal = waves.reduce((n, w) => n + w.total, 0);
  const finished = waves.length > 0 && activeWave === null;
  const active = waves.find(w => w.active) || null;

  const parts = [];
  if (active) parts.push(`Wave ${active.number} of ${waves.length}: ${active.name}`);
  else if (finished) parts.push(`Every wave is closed (${waves.length} of ${waves.length})`);
  parts.push(`${plannedClosed} of ${plannedTotal} planned tasks closed`);
  parts.push(`${inFlight.length} in flight`);
  if (coverage) parts.push(`${coverage.unplanned} of ${coverage.open} open tasks unplanned (${coverage.share}%)`);

  const empty = !base.planExists || waves.length === 0;
  return {
    ...base,
    // No plan is an answer, not an error: the order is an optional decision.
    state: empty ? "empty" : "ready",
    emptyReason: !base.planExists ? "no-plan" : waves.length === 0 ? "no-waves" : null,
    dependenciesKnown: taskList !== null,
    summary: {
      parts,
      activeWave: active ? { index: active.index, number: active.number, name: active.name } : null,
      waveCount: waves.length,
      plannedClosed,
      plannedTotal,
      inFlight: inFlight.length,
      finished,
      coverage,
    },
    activeWave,
    waves,
    mayStartNow,
    inFlight,
    inFlightNext,
    overtaken,
    unplanned: {
      count: unplannedRows.length,
      sentence: coverage
        ? `${coverage.unplanned} of ${coverage.open} open tasks (${coverage.share}%) are outside every wave.`
        : `${unplannedRows.length} open tasks are outside every wave.`,
      tasks: unplannedRows,
    },
  };
}
