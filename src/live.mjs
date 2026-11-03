/**
 * Live refresh (UI-7): ONE `branchling follow --json` child per server (per
 * backlog), shared by every page that listens on /api/events and by the read
 * cache. It spawns nothing itself: the child is the adapter's `follow` handle,
 * and src/adapter.mjs stays the only module that starts branchling.
 *
 * WHAT IT IS FOR. Pushing "something changed" to open pages, so they re-read
 * instead of polling, and bumping a generation the cache folds into its token
 * (src/cache.mjs, `withLiveChanges`), so a read after an event never hits an
 * entry stored before it. It does NOT replace the cache's file fingerprint:
 * `follow` does not see other worktrees or branches, git refs, plan.yaml,
 * history records or `updated:` (see `branchling follow --help`), which the
 * fingerprint does.
 *
 * STATES. "idle" (not started), "starting" (child spawned, no `ready` yet),
 * "live" (after `ready`), "down" (the child exited unexpectedly; a restart is
 * scheduled), "closed".
 *
 * WHAT A LISTENER IS TOLD (the server turns each into one SSE event):
 *   { type: "connected", resync }    the stream is armed. `resync: true` when
 *                                    it follows a "down" or a "starting" that
 *                                    listeners joined: a change may have been
 *                                    missed, so a page re-reads
 *   { type: "disconnected" }         the child is down; pages say so
 *   { type: "change", id, change, fields, file, at }
 *                                    one task changed. `id: null` means a line
 *                                    could not be read (a ContractMismatch):
 *                                    something may have changed, which one is
 *                                    unknown
 * A listener that subscribes is told the current state at once: "connected"
 * (resync false) while live, "disconnected" while down, nothing while starting.
 *
 * RESTART POLICY. An exit that `close()` did not ask for marks the stream
 * down and restarts it after `backoff.initialMs` (1 s), doubling up to
 * `backoff.maxMs` (30 s). The delay goes back to the start once a child has
 * stayed live for `backoff.stableMs` (10 s), so a child that dies right after
 * `ready` cannot restart once a second forever. A child silent for three
 * heartbeats is taken to be hung and is stopped, which restarts it.
 *
 * STARTED BY WHOM. `bin/branchling-ui.mjs` calls `start()` at startup
 * (eager). A page that opens later joins an already-armed stream, so no
 * change can fall between its first read and `ready`; lazily started on the
 * first page, the first second of every server would be such a window. The
 * cost is one idle process for the life of the server, whose purpose is to be
 * looked at. `subscribe()` also starts it, for a caller that did not.
 */

/** The cadence `follow` is asked to keep (seconds): also bounds how long a
 *  child outlives a parent that died without closing it (`follow --help`). */
export const FOLLOW_HEARTBEAT_S = 15;
export const BACKOFF = Object.freeze({ initialMs: 1000, maxMs: 30_000, stableMs: 10_000 });

/**
 * @param {object} options
 * @param {{ follow: Function }} options.adapter what createAdapter() returns
 * @param {number} [options.heartbeat] seconds, passed to `follow --heartbeat`
 * @param {{ initialMs?: number, maxMs?: number, stableMs?: number }} [options.backoff]
 * @param {(line: string) => void} [options.log]
 */
export function createLive({ adapter, heartbeat = FOLLOW_HEARTBEAT_S, backoff = {}, log = line => console.error(line), now = Date.now } = {}) {
  if (!adapter || typeof adapter.follow !== "function") throw new TypeError("createLive needs an adapter with follow()");
  const policy = { ...BACKOFF, ...backoff };
  const listeners = new Set();
  let state = "idle";
  let generation = 0;
  let handle = null;
  let delay = policy.initialMs;
  let restartTimer = null;
  let watchdog = null;
  let liveSince = 0;
  let missed = false; // listeners may have missed a change since the last "connected"

  function tell(event) {
    for (const fn of [...listeners]) {
      try { fn(event); } catch (err) { log(`branchling-ui: live listener failed: ${err.message}`); }
    }
  }

  function armWatchdog() {
    clearTimeout(watchdog);
    if (!heartbeat || !handle) return;
    const current = handle;
    watchdog = setTimeout(() => {
      log(`branchling-ui: follow printed nothing for ${heartbeat * 3} s; restarting it`);
      current.close();
    }, heartbeat * 3000);
    watchdog.unref?.();
  }

  function onEnvelope(envelope) {
    armWatchdog();
    if (envelope.event === "ready") {
      generation++;
      state = "live";
      liveSince = now();
      const resync = missed || listeners.size > 0;
      missed = false;
      tell({ type: "connected", resync });
    } else if (envelope.event === "change") {
      generation++;
      tell({ type: "change", id: envelope.id, change: envelope.change, fields: envelope.fields, file: envelope.file, at: envelope.at });
    }
  }

  function onMismatch(err) {
    armWatchdog();
    generation++;
    log(`branchling-ui: follow printed a line this package cannot read: ${err.message}`);
    tell({ type: "change", id: null, change: null, fields: [], file: null, at: null });
  }

  function spawnChild() {
    restartTimer = null;
    if (state === "closed") return;
    state = state === "down" ? "down" : "starting";
    let current;
    try {
      current = adapter.follow({ heartbeat });
    } catch (err) {
      log(`branchling-ui: follow could not start: ${err.message}`);
      onExit({ code: null, signal: null, stderr: "", error: err });
      return;
    }
    handle = current;
    current.on("envelope", onEnvelope);
    current.on("mismatch", onMismatch);
    current.once("exit", info => { if (handle === current) onExit(info); });
    armWatchdog();
  }

  function onExit(info) {
    clearTimeout(watchdog);
    handle = null;
    if (state === "closed") return;
    generation++;
    const wasDown = state === "down";
    if (state === "live" && now() - liveSince >= policy.stableMs) delay = policy.initialMs;
    state = "down";
    missed = true;
    const why = info.error ? info.error.message : `exit ${info.code ?? info.signal}${info.stderr ? `: ${info.stderr.trim().split("\n").pop()}` : ""}`;
    log(`branchling-ui: follow stopped (${why}); restarting in ${delay} ms`);
    if (!wasDown) tell({ type: "disconnected" });
    restartTimer = setTimeout(spawnChild, delay);
    restartTimer.unref?.();
    delay = Math.min(delay * 2, policy.maxMs);
  }

  return {
    /** Starts the child once; later calls do nothing. */
    start() {
      if (state === "idle") spawnChild();
    },

    /** `fn(event)` for every event; returns the unsubscribe function. */
    subscribe(fn) {
      listeners.add(fn);
      this.start();
      if (state === "live") fn({ type: "connected", resync: false });
      else if (state === "down") fn({ type: "disconnected" });
      return () => listeners.delete(fn);
    },

    /** `{ state, generation }`; the generation moves on every change, ready and exit. */
    snapshot: () => ({ state, generation }),

    /** The running child's pid, or null (tests use it to kill the child and to see it gone). */
    get pid() { return handle ? handle.pid : null; },

    /** Stops the child and every restart; resolves once the child has exited. */
    async close() {
      if (state === "closed") return;
      state = "closed";
      clearTimeout(restartTimer);
      clearTimeout(watchdog);
      listeners.clear();
      const current = handle;
      handle = null;
      if (current) await current.close();
    },
  };
}
