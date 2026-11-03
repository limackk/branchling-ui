/**
 * What the page says about live refresh (UI-7), as data shared by both
 * surfaces: the web page renders it (src/web/live.mjs); the terminal
 * interface could, should it subscribe to the same stream one day.
 *
 * The notice is shown only when something is wrong or waiting. While the
 * stream is live and nothing is deferred there is no notice at all: a
 * permanent "live" badge would be one more thing to read on every screen.
 */

export const LIVE_TEXT = {
  disconnected: "Live updates stopped. What you see may be out of date.",
  deferred: "The backlog changed. This view refreshes when you leave the form you are filling in.",
  refreshNow: "Refresh now",
};

/**
 * @param {{ connection: "unknown"|"live"|"down", deferred: boolean }} state
 * @returns {null | { tone: "live-off"|"stale", icon: string, text: string, action: string }}
 *   null when there is nothing to say. "down" wins over "deferred": an out-of-date
 *   screen is the bigger news.
 */
export function liveNotice({ connection, deferred }) {
  if (connection === "down") return { tone: "live-off", icon: "unplug", text: LIVE_TEXT.disconnected, action: LIVE_TEXT.refreshNow };
  if (deferred) return { tone: "stale", icon: "refresh", text: LIVE_TEXT.deferred, action: LIVE_TEXT.refreshNow };
  return null;
}
