/**
 * The startup wiring of the terminal interface (UI-20), kept out of the bin
 * file so the tests can run it: the branchling version check and UI-2's read
 * cache around the adapter.
 *
 * VERSION. Like the web entry (bin/branchling-ui.mjs), an executable outside
 * SUPPORTED_RANGE is a warning, not a refusal to start: the adapter still
 * checks every envelope's schemaVersion and kind, so a branchling that really
 * speaks another contract shows up as an error screen on the first read. The
 * warning goes to stderr BEFORE the TUI takes the alternate screen, so it
 * stays on the main screen and is there when the user quits; in a pipe it
 * never mixes with the screen printed on stdout. A version that cannot be
 * read at all is reported the same way and left to the first read to show.
 *
 * CACHE. createCache fingerprints the backlog directory, so it needs to know
 * where that is. With `--dir` it is the directory given. Without it, the
 * directory branchling itself found is taken from `backlog.root` of one
 * `where --json` envelope (UI-38; before branchling 0.3.0 printed `where` as
 * an envelope, the `root` of a whole `stats --json`), as the web entry does.
 * If `where` finds no backlog or fails, the TUI runs uncached and its first
 * screen shows the failure. The cache is returned through `servedFromCache`, the same join the
 * server uses, so runTui takes one scope per refresh and gets bare envelopes.
 */

import { createCache as defaultCreateCache, servedFromCache } from "../cache.mjs";

/**
 * @param {object} options
 * @param {object} options.adapter from createAdapter, given the same dir and cwd
 * @param {string} [options.dir] the backlog directory, absolute, when known
 * @param {string} [options.cwd]
 * @param {(message: string) => void} [options.warn]
 * @param {typeof defaultCreateCache} [options.createCache]
 * @returns {Promise<{ adapter: object, version: string|null, supported: boolean|null, cached: boolean }>}
 *   `adapter` is the bare adapter, or `servedFromCache(cache)` when cached.
 */
export async function prepareAdapter({ adapter, dir, cwd, warn = () => {}, createCache = defaultCreateCache }) {
  let version = null;
  let supported = null;
  try {
    ({ version, supported } = await adapter.version());
    if (!supported) warn(`branchling-ui-tui: branchling ${version} is outside the supported range; views may refuse to render`);
  } catch (err) {
    warn(`branchling-ui-tui: could not read the branchling version (${String((err && err.message) || err).split("\n")[0]})`);
  }

  let backlogDir = dir;
  if (!backlogDir) {
    try {
      const { backlog } = await adapter.where();
      if (backlog) backlogDir = backlog.root;
    } catch {
      // The first read through the uncached adapter reports the same failure on screen.
    }
  }
  if (!backlogDir) return { adapter, version, supported, cached: false };
  return { adapter: servedFromCache(createCache(adapter, { dir: backlogDir, cwd })), version, supported, cached: true };
}
