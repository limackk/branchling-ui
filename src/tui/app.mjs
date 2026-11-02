/**
 * The terminal interface: a screen per view model (stats, plan, release
 * pipeline, decisions; src/tui/screens/), fed by the adapter through the
 * shared view model, rendered by src/tui/render.mjs.
 *
 * Data comes only from the adapter, each screen's `read` making the same calls
 * the web page's routes make; nothing here spawns a process or reads a backlog
 * file. The models are built by src/view-model/, the same code the web page
 * runs, and this module only decides when to fetch, which screen is shown and
 * when to redraw.
 *
 * Every stream and the process-like event source are injectable, so the tests
 * run the whole loop with fake objects and no terminal.
 */

import { fromAdapterError, loadingState } from "../view-model/states.mjs";
import { KEYS, actionFor, maxScroll, renderScreen } from "./render.mjs";
import { SCREENS, screenById } from "./screens/index.mjs";
import { canDriveScreen, colourEnabled, createScreen } from "./terminal.mjs";

/** Exit codes, as a shell would report the matching signal. */
const SIGNAL_CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

/**
 * One read for one screen. Through the cache the object given is
 * `servedFromCache(cache)` (src/cache.mjs), the same join the server uses:
 * each refresh takes ONE scope, whose adapter returns bare envelopes and whose
 * `answeredAt()` is when the answer reflects the backlog (the oldest of the
 * reads the screen made; for a cache hit, the time of the spawn that produced
 * it, never the hit). A bare adapter has no answer time.
 *
 * A failure of the adapter is a state to show. A model that throws on what
 * the adapter accepted is a bug, not a state: it propagates and ends the run
 * with the terminal restored.
 */
async function fetchModel(screen, source, now) {
  const scope = typeof source.forRequest === "function" ? source.forRequest() : null;
  const adapter = scope ? scope.adapter : source;
  let input;
  try {
    input = await screen.read(adapter);
  } catch (err) {
    return { model: fromAdapterError(screen.id, err), input: null, fetchedAt: null };
  }
  const at = scope ? scope.answeredAt() : null;
  const fetchedAt = at === null || at === undefined ? null : new Date(at).toISOString();
  return { model: screen.model(input, { fetchedAt }, now()), input, fetchedAt };
}

/**
 * Runs the interface until the user quits, a signal arrives or something
 * throws. Resolves with the exit code; never leaves the terminal changed.
 *
 * @param {object} options
 * @param {object} options.adapter a bare adapter, or
 *   `servedFromCache(createCache(...))`, which has `forRequest()` instead
 * @param {string} [options.screen] the screen shown first (and the one printed
 *   when the full screen is not available): stats, plan, release or decisions
 * @param {any} [options.stdin] @param {any} [options.stdout] @param {any} [options.stderr]
 * @param {any} [options.proc] emits SIGINT, SIGTERM, SIGHUP, uncaughtException, unhandledRejection, exit
 * @param {Record<string, string|undefined>} [options.env]
 * @param {typeof renderScreen} [options.render] for tests
 * @param {() => number} [options.now] the clock, for the ages of questions
 * @returns {Promise<number>}
 */
export async function runTui({
  adapter,
  screen: first = SCREENS[0].id,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  proc = process,
  env = process.env,
  render = renderScreen,
  now = Date.now,
} = {}) {
  const firstScreen = screenById(first);
  if (!firstScreen) throw new RangeError(`no screen named ${JSON.stringify(first)}; the screens are ${SCREENS.map(s => s.id).join(", ")}`);
  const colour = colourEnabled(stdout, env);

  if (!canDriveScreen({ stdin, stdout, env })) {
    // Piped, redirected or TERM=dumb: print the screen once, plainly or with
    // colour as stdout allows, and stop. Raw mode is never touched.
    const { model } = await fetchModel(firstScreen, adapter, now);
    stdout.write(render(model, { width: stdout.columns || 80, colour }).join("\n") + "\n");
    return model.state === "ready" || model.state === "empty" ? 0 : 1;
  }

  return new Promise(resolve => {
    const screen = createScreen({ stdin, stdout });
    // What each screen shows: its model, the last answer it had (kept to show
    // stale while a new read runs), its read generation and its scroll.
    const states = new Map(SCREENS.map(s => [s.id, { model: loadingState(s.id), last: null, generation: 0, offset: 0 }]));
    let current = firstScreen.id;
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

    const size = () => ({ width: stdout.columns || 80, height: stdout.rows || 24 });

    function draw() {
      if (finished) return;
      const st = states.get(current);
      st.offset = Math.min(st.offset, maxScroll(st.model, size()));
      screen.draw(render(st.model, { ...size(), colour, keys: KEYS, offset: st.offset }));
    }

    async function refresh(id = current) {
      const scr = screenById(id);
      const st = states.get(id);
      const mine = ++st.generation;
      // Keep what is on screen while the new read runs, marked stale, rather
      // than blanking it. The cache never hands out a stale answer (a hit
      // means nothing changed), so "stale" here only ever means "in flight".
      st.model = st.last ? scr.model(st.last.input, { stale: true, fetchedAt: st.last.fetchedAt }, now()) : loadingState(id);
      if (id === current) draw();
      const next = await fetchModel(scr, adapter, now);
      if (finished || mine !== st.generation) return;
      st.model = next.model;
      if (next.input !== null) st.last = { input: next.input, fetchedAt: next.fetchedAt };
      if (id === current) draw();
    }

    /** Shows another screen and reads it again; its last answer, if any, is shown stale meanwhile. */
    function show(id) {
      if (id === current) return undefined;
      current = id;
      return refresh(id);
    }

    function scroll(by) {
      const st = states.get(current);
      const to = Math.min(Math.max(st.offset + by, 0), maxScroll(st.model, size()));
      if (to === st.offset) return;
      st.offset = to;
      draw();
    }

    function onKey(chunk) {
      const text = String(chunk);
      // An escape sequence (arrow keys, function keys) is not a command.
      if (text.startsWith("\x1b")) return undefined;
      for (const ch of text) {
        if (ch === "\x03") return finish(SIGNAL_CODES.SIGINT); // Ctrl-C arrives as a key in raw mode
        const action = actionFor(ch, KEYS);
        if (action === "quit") return finish(0);
        if (action === "refresh") return refresh();
        if (action === "next") return show(SCREENS[(SCREENS.findIndex(s => s.id === current) + 1) % SCREENS.length].id);
        if (action === "down") scroll(1);
        else if (action === "up") scroll(-1);
        else if (action && action.startsWith("screen:")) return show(action.slice("screen:".length));
      }
      return undefined;
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
