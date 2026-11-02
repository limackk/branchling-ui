/**
 * The terminal interface: one stats screen, fed by the adapter through the
 * shared view model, rendered by src/tui/render.mjs.
 *
 * Data comes only from `adapter.stats()`; nothing here spawns a process or
 * reads a backlog file. The model is built by src/view-model/, the same code
 * the web page runs, and this module only decides when to fetch and redraw.
 *
 * Every stream and the process-like event source are injectable, so the tests
 * run the whole loop with fake objects and no terminal.
 */

import { fromAdapterError, loadingState } from "../view-model/states.mjs";
import { statsModel } from "../view-model/stats.mjs";
import { KEYS, renderScreen } from "./render.mjs";
import { canDriveScreen, colourEnabled, createScreen } from "./terminal.mjs";

/** Exit codes, as a shell would report the matching signal. */
const SIGNAL_CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

/**
 * One read of the stats. Through the cache the object given is
 * `servedFromCache(cache)` (src/cache.mjs), the same join the server uses:
 * each refresh takes ONE scope, whose adapter returns bare envelopes and whose
 * `answeredAt()` is when the answer reflects the backlog (for a cache hit, the
 * time of the spawn that produced it, never the hit). A bare adapter has no
 * answer time.
 */
async function fetchModel(source) {
  const scope = typeof source.forRequest === "function" ? source.forRequest() : null;
  const adapter = scope ? scope.adapter : source;
  let envelope;
  try {
    envelope = await adapter.stats();
  } catch (err) {
    return { model: fromAdapterError("stats", err), envelope: null, fetchedAt: null };
  }
  const at = scope ? scope.answeredAt() : null;
  const fetchedAt = at === null || at === undefined ? null : new Date(at).toISOString();
  // A malformed envelope throws here: that is a bug, not a state to show.
  return { model: statsModel(envelope, { fetchedAt }), envelope, fetchedAt };
}

/**
 * Runs the interface until the user quits, a signal arrives or something
 * throws. Resolves with the exit code; never leaves the terminal changed.
 *
 * @param {object} options
 * @param {{ stats: () => Promise<object> } | { forRequest: () => object }} options.adapter a bare adapter, or
 *   `servedFromCache(createCache(...))`, which has `forRequest()` instead
 * @param {any} [options.stdin] @param {any} [options.stdout] @param {any} [options.stderr]
 * @param {any} [options.proc] emits SIGINT, SIGTERM, SIGHUP, uncaughtException, unhandledRejection, exit
 * @param {Record<string, string|undefined>} [options.env]
 * @param {typeof renderScreen} [options.render] for tests
 * @returns {Promise<number>}
 */
export async function runTui({
  adapter,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  proc = process,
  env = process.env,
  render = renderScreen,
} = {}) {
  const colour = colourEnabled(stdout, env);

  if (!canDriveScreen({ stdin, stdout, env })) {
    // Piped, redirected or TERM=dumb: print the screen once, plainly or with
    // colour as stdout allows, and stop. Raw mode is never touched.
    const { model } = await fetchModel(adapter);
    stdout.write(render(model, { width: stdout.columns || 80, colour }).join("\n") + "\n");
    return model.state === "ready" || model.state === "empty" ? 0 : 1;
  }

  return new Promise(resolve => {
    const screen = createScreen({ stdin, stdout });
    let model = loadingState("stats");
    let lastEnvelope = null;
    let lastFetchedAt = null;
    let generation = 0;
    let finished = false;

    const listeners = [];
    const listen = (emitter, event, fn) => {
      emitter.on(event, fn);
      listeners.push([emitter, event, fn]);
    };

    function finish(code, err) {
      if (finished) return;
      finished = true;
      for (const [emitter, event, fn] of listeners) emitter.removeListener(event, fn);
      screen.restore();
      if (err !== undefined) {
        try { stderr.write(`branchling-ui-tui: ${(err && err.stack) || err}\n`); } catch { /* nothing left to tell */ }
      }
      resolve(code);
    }

    /** Any exception in a handler, synchronous or not, ends the run with the terminal restored. */
    const guard = fn => (...args) => {
      try {
        const result = fn(...args);
        if (result && typeof result.then === "function") result.catch(err => finish(1, err));
      } catch (err) {
        finish(1, err);
      }
    };

    function draw() {
      if (finished) return;
      screen.draw(render(model, { width: stdout.columns || 80, height: stdout.rows || 24, colour, keys: KEYS }));
    }

    async function refresh() {
      const mine = ++generation;
      // Keep what is on screen while the new read runs, marked stale, rather
      // than blanking it. The cache never hands out a stale answer (a hit
      // means nothing changed), so "stale" here only ever means "in flight".
      model = lastEnvelope ? statsModel(lastEnvelope, { stale: true, fetchedAt: lastFetchedAt }) : loadingState("stats");
      draw();
      const next = await fetchModel(adapter);
      if (finished || mine !== generation) return;
      model = next.model;
      if (next.envelope) { lastEnvelope = next.envelope; lastFetchedAt = next.fetchedAt; }
      draw();
    }

    function onKey(chunk) {
      const text = String(chunk);
      // An escape sequence (arrow keys, function keys) is not a command.
      if (text.startsWith("\x1b")) return;
      for (const ch of text) {
        if (ch === "\x03") return finish(SIGNAL_CODES.SIGINT); // Ctrl-C arrives as a key in raw mode
        if (ch === "q" || ch === "Q") return finish(0);
        if (ch === "r" || ch === "R") return refresh();
      }
    }

    for (const [signal, code] of Object.entries(SIGNAL_CODES)) listen(proc, signal, () => finish(code));
    listen(proc, "uncaughtException", err => finish(1, err));
    listen(proc, "unhandledRejection", reason => finish(1, reason));
    // Last resort: process.exit() from anywhere still restores, synchronously.
    listen(proc, "exit", () => screen.restore());
    // Windows has no SIGWINCH; Node emits 'resize' on stdout on every platform.
    listen(stdout, "resize", guard(draw));
    listen(stdin, "data", guard(onKey));

    guard(() => {
      screen.enter();
      return refresh();
    })();
  });
}
