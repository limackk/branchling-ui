/**
 * The stats view model: plain data computed from a `stats` envelope.
 *
 * Both surfaces render THIS, never the envelope: the web page (src/web/) and
 * the terminal interface (UI-16). So the module is pure and portable: no
 * `node:` import, no DOM, no HTML, no ANSI escape codes, no I/O. The browser
 * loads it as a native ES module from the server's /view-model/ path; Node
 * imports it directly. If a surface needs something the model lacks, add it
 * here, with a test, rather than computing it in the surface.
 */

import { priorityRole, statusRole } from "./roles.mjs";

/*
 * Counts that depend on the vocabulary (which statuses are archived, which
 * block) are taken from the envelope as branchling computed them, never
 * derived here from status names: a backlog may name its statuses anything.
 * That holds until UI-18 brings the vocabulary from the CLI.
 */

function rows(counts, role) {
  return Object.entries(counts || {}).map(([key, count]) => ({
    key,
    label: key.replace(/_/g, " "),
    count: Number(count) || 0,
    role: role(key),
  }));
}

/**
 * @param {object} envelope a `stats` envelope from adapter.stats()
 * @param {{ stale?: boolean, fetchedAt?: string|null }} [freshness]
 *   Where the data came from. Until UI-2 adds the cache every response is
 *   fresh; the field exists now so no surface has to change when it lands.
 */
export function statsModel(envelope, freshness = {}) {
  if (!envelope || envelope.kind !== "stats" || !envelope.stats) {
    throw new TypeError("statsModel needs a stats envelope");
  }
  const s = envelope.stats;
  const byStatus = rows(s.byStatus, statusRole);
  const total = Number(s.total) || 0;

  return {
    view: "stats",
    // "empty" is an answer, not an error: the backlog exists and has no tasks.
    state: total === 0 ? "empty" : "ready",
    freshness: { stale: freshness.stale === true, fetchedAt: freshness.fetchedAt ?? null },
    root: typeof envelope.root === "string" ? envelope.root : null,
    totals: [
      { key: "total", label: "Tasks", value: total },
      { key: "active", label: "Active", value: Number(s.active) || 0 },
      { key: "blocked", label: "Blocked", value: Number(s.blocked) || 0 },
      { key: "archived", label: "Archived", value: Number(s.archived) || 0 },
    ],
    byStatus,
    byPriority: rows(s.byPriority, priorityRole).sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true })),
    openHours: {
      hours: Number(s.openHours?.hours) || 0,
      unknown: Number(s.openHours?.unknown) || 0,
    },
  };
}
