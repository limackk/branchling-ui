/**
 * Colour ROLES for statuses and priorities. A role is a name a surface maps to
 * its own colours (CSS custom properties on the web, an ANSI palette in the
 * terminal); the view model never carries a colour value itself.
 *
 * WHERE THE MEANING COMES FROM (UI-18). The vocabulary lives in the backlog's
 * config.yaml, which this package may not read; branchling answers it as the
 * `vocabulary` envelope (upstream TL-532, adapter.vocabulary()). Each status
 * there carries a semantic role branchling derived or was told (open, active,
 * waiting, closed, cancelled), and the priorities come in declared order. This
 * module maps those to colour roles; it never guesses from a name, because a
 * backlog may call its statuses anything.
 *
 * WHY A MODULE-LEVEL VOCABULARY AND NOT AN ARGUMENT. One page, and one
 * terminal process, show exactly one backlog, so there is exactly one
 * vocabulary to know. Every view model already calls statusRole and
 * priorityRole; threading the envelope through each of them, and through each
 * surface that builds them, would change every signature for a value that is
 * the same in all of them. A surface loads it once with `useVocabulary` before
 * it renders (src/web/app.mjs, src/tui/app.mjs). An explicit last argument
 * still wins, for a caller (or a test) that holds its own.
 *
 * WHEN IT IS NOT KNOWN. Before it is loaded, when the executable predates the
 * command (branchling 0.3.0), or when the read failed, every status and
 * priority is "neutral": a neutral palette is honest about not knowing, a
 * guessed one is wrong in somebody else's backlog. A status or priority the
 * vocabulary does not declare (a task file written by hand) is neutral too.
 *
 * The module stays pure and portable: no `node:` import, no DOM, no I/O.
 */

/** The roles a surface must be able to show (src/web/styles.css styles all of them). */
export const ROLES = ["neutral", "progress", "attention", "danger", "success", "muted"];

/**
 * branchling's semantic status role -> the colour role a surface paints.
 * An unknown semantic role (a later branchling adding one) is neutral, not an
 * error: colour is decoration, and the label still names the status.
 */
export const STATUS_ROLE_COLOURS = Object.freeze({
  open: "neutral",
  active: "progress",
  waiting: "attention",
  closed: "success",
  cancelled: "muted",
});

/**
 * Priorities have no semantic role in the envelope, only a declared order,
 * most urgent first. So only the order is read: the first is `danger`, the
 * second `attention`, the last of three or more is `muted`, and the rest are
 * `neutral`. A backlog with one priority colours nothing, since "most urgent"
 * means nothing without a second one.
 */
export function priorityColourAt(index, count) {
  if (count < 2 || index < 0 || index >= count) return "neutral";
  if (index === 0) return "danger";
  if (index === 1) return "attention";
  if (count >= 3 && index === count - 1) return "muted";
  return "neutral";
}

/**
 * The vocabulary as this module uses it: lookups and declared orders, or
 * `null` for "not known". Accepts the envelope adapter.vocabulary() returns,
 * or null; anything without status and priority lists is "not known".
 *
 * @param {object|null|undefined} envelope
 * `boardOrder` is the declared boards' slugs in declared order (UI-53), or
 * null when the envelope carries no `boards` list.
 *
 * @returns {{ statuses: Map<string,string>, priorities: Map<string,string>, statusOrder: string[], priorityOrder: string[], boardOrder: string[]|null, archived: Set<string> } | null}
 */
export function vocabularyRoles(envelope) {
  if (!envelope || !Array.isArray(envelope.statuses) || !Array.isArray(envelope.priorities)) return null;
  const statuses = new Map();
  const archived = new Set();
  for (const s of envelope.statuses) {
    if (!s || typeof s.name !== "string") continue;
    statuses.set(s.name, Object.hasOwn(STATUS_ROLE_COLOURS, s.role) ? STATUS_ROLE_COLOURS[s.role] : "neutral");
    if (s.archived === true) archived.add(s.name);
  }
  const priorityOrder = envelope.priorities.filter(p => typeof p === "string");
  const priorities = new Map(priorityOrder.map((p, i) => [p, priorityColourAt(i, priorityOrder.length)]));
  const boardOrder = Array.isArray(envelope.boards)
    ? [...new Set(envelope.boards.map(b => (typeof b === "string" ? b : b && typeof b.slug === "string" ? b.slug : "")).filter(Boolean))]
    : null;
  return Object.freeze({ statuses, priorities, statusOrder: [...statuses.keys()], priorityOrder, boardOrder, archived });
}

let current = null;

/** Sets the vocabulary every later call without an explicit one reads; null forgets it. */
export function useVocabulary(envelope) {
  current = vocabularyRoles(envelope);
  return current;
}

/** The vocabulary in use, or null when it is not known. */
export function currentVocabulary() {
  return current;
}

export function statusRole(status, vocabulary = current) {
  return (vocabulary && vocabulary.statuses.get(status)) || "neutral";
}

export function priorityRole(priority, vocabulary = current) {
  return (vocabulary && vocabulary.priorities.get(priority)) || "neutral";
}

/**
 * A comparator over names in declared order: declared names first, in the
 * order config.yaml gives, then undeclared ones by name. Without a vocabulary
 * it is by name alone (numeric-aware, so P2 sorts before P10).
 */
function byDeclaredOrder(order, a, b) {
  const ia = order ? order.indexOf(a) : -1;
  const ib = order ? order.indexOf(b) : -1;
  const ra = ia === -1 ? Infinity : ia;
  const rb = ib === -1 ? Infinity : ib;
  if (ra !== rb) return ra < rb ? -1 : 1;
  return String(a).localeCompare(String(b), "en", { numeric: true });
}

export function compareStatuses(a, b, vocabulary = current) {
  return byDeclaredOrder(vocabulary && vocabulary.statusOrder, a, b);
}

export function comparePriorities(a, b, vocabulary = current) {
  return byDeclaredOrder(vocabulary && vocabulary.priorityOrder, a, b);
}
