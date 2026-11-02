/**
 * Colour ROLES for statuses and priorities. A role is a name a surface maps to
 * its own colours (CSS custom properties on the web, an ANSI palette in the
 * terminal); the view model never carries a colour value itself.
 *
 * Every status and every priority is "neutral" for now. The vocabulary (which
 * statuses exist, which are terminal, how priorities rank) lives in the
 * backlog's config.yaml, which this package may not read, and no branchling
 * command returns it as JSON yet: `stats --json` gives only the keys of
 * byStatus and byPriority. Guessing from key names would colour a renamed or
 * custom status wrongly in someone else's backlog. UI-18 tracks the upstream
 * command; when it lands, these functions take the vocabulary as an argument.
 */

/** The roles a surface must be able to show (src/web/styles.css styles all
 *  of them). Only "neutral" is handed out until UI-18. */
export const ROLES = ["neutral", "progress", "attention", "danger", "success", "muted"];

export function statusRole(_status) {
  return "neutral";
}

export function priorityRole(_priority) {
  return "neutral";
}
