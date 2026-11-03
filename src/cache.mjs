/**
 * Repeated reads of an unchanged backlog spawn nothing (UI-2).
 *
 * WHY. One `query --json` costs about 500 ms of process start and tree scan.
 * A view that refreshes several panels would spend seconds per refresh, so the
 * reading calls of an adapter from `createAdapter` are answered from memory
 * while nothing they depend on has changed. This module never spawns
 * branchling itself: every answer it hands out was produced by the wrapped
 * adapter, which stays the only door.
 *
 * NEVER STALE IS THE OVERRIDING RULE. A stale answer reads exactly like a
 * fresh one, so a cache that is right "almost always" is worse than none. That
 * is why change detection is a FINGERPRINT COMPUTED ON EVERY READ, not
 * `fs.watch`: watch events arrive asynchronously (a read right after a write
 * could still hit), and recursive watching does not exist on Linux under Node
 * 18/19. The fingerprint is taken BEFORE the spawn and the answer is stored
 * under it, so a change that lands while branchling runs makes the next read
 * miss. A hit therefore means: nothing observable changed since a moment
 * before this answer was computed.
 *
 * WHAT THE DEFAULT FINGERPRINT LOOKS AT, AND WHY THAT IS NOT READING THE
 * BACKLOG. `createFileChanges` walks the backlog directory and records, per
 * entry, its relative path, type, size, inode, mtime and ctime in nanoseconds
 * (`stat({ bigint: true })`). It reads directory listings and file METADATA
 * only, never a file's contents, and it attaches no meaning to any name: the
 * directory is an opaque box that either did or did not change. The rule that
 * only the adapter reads the backlog exists so this package never depends on
 * branchling's file format; a stat walk knows nothing about that format, and
 * every value a caller sees still comes from branchling's own `--json`.
 *   - ctime is there for the same-size edit whose mtime was restored (or fell
 *     into the same timestamp tick): ctime cannot be set from user space.
 *   - RACY TIMESTAMPS. A file system stores time in ticks (ns on APFS and
 *     ext4, but the kernel clock behind them can be milliseconds coarse; 1 s
 *     on HFS+, 2 s for mtime on FAT). A second same-size write inside the tick
 *     of the first is invisible to stat. Like git's "racily clean" index
 *     entries, when the newest mtime/ctime under the directory is younger
 *     than `racyMs` (default RACY_MS), the source cannot vouch for the state
 *     and answers `null`: that read is not cached. The cost is a few extra
 *     spawns right after a write, which is the moment a view refetches anyway.
 *     A network file system whose clock is skewed further than `racyMs`
 *     defeats this guard; give it a larger `racyMs`.
 *   - EXCLUDED: nothing. Running query, stats, plan, show, log and deploy
 *     status over a fixture backlog was checked to leave every path, size and
 *     mtime under the backlog directory, and under `.git`, unchanged
 *     (branchling 0.2.0, 2026-11-02). Generated views (INDEX.yaml, NOW.yaml,
 *     boards/) rewritten by `build` cause a conservative miss, which is fine.
 *
 * CROSS-BRANCH STATE. branchling also answers from other branches and
 * worktrees (`elsewhere`, `next-id`, deploy status against refs). The
 * fingerprint therefore includes, from `git` run with an argument array and no
 * shell:
 *   - `git worktree list --porcelain`: the path, HEAD and branch of EVERY
 *     worktree, this one included, so it carries what `git rev-parse HEAD`
 *     would, plus commits and checkouts in sibling worktrees;
 *   - `git for-each-ref`: every ref with its object, so a commit on any
 *     branch, a fetch that moves a remote ref, or a new tag changes it;
 *   - the same metadata walk over the backlog directory at the same relative
 *     path inside every OTHER worktree, because `show` was checked to report
 *     an uncommitted status change made in a sibling worktree.
 * A backlog directory outside any git repository is fingerprinted by the walk
 * alone; git failing (no repository, no git installed) is a constant marker,
 * never a crash.
 *
 * KNOWN LIMITS, each one a way the answer can change with no change seen here:
 *   - branchling's per-machine state outside the repository: the reservation
 *     lockfiles that `take` writes under the user's state directory and the
 *     preferences under the user's config directory (`branchling where`
 *     names the config one; the locks are under `$XDG_STATE_HOME/branchling`,
 *     else `~/.local/state/branchling`). No reading envelope was seen to
 *     expose a reservation, but nothing promises that.
 *   - a sibling worktree that keeps its backlog at a DIFFERENT relative path.
 *   - other clones reachable only through a remote: their state arrives with
 *     a fetch, which moves a remote ref and so is covered.
 *   - the branchling executable itself being upgraded under a running cache.
 * Until `branchling watch --json` exists (upstream TL-524), these are the
 * honest edges of a file-system fingerprint.
 *
 * THE SEAM FOR TL-524. Change detection is an injectable object:
 *
 *   createCache(adapter, { changes })   // changes = { async token() }
 *
 * `token()` resolves to a string that differs whenever the backlog may have
 * changed, or to `null` when it cannot vouch for the current state (that read
 * is then neither answered from nor stored in the cache). The default is
 * `createFileChanges({ dir, cwd })`. A source built on `branchling watch
 * --json` (UI-7) would bump a generation counter on each event and return it;
 * it must still answer `null` until its stream is known to be live, or the
 * window between subscribing and the first event would be stale.
 *
 * WHAT A CACHED CALL RETURNS. The reading methods (query, stats, plan, show,
 * log, deployStatus) resolve to a frozen
 *
 *   { envelope, answeredAt, fromCache }
 *
 * not to a bare envelope, so the time of the answer cannot be lost by
 * spreading or cloning the envelope. `answeredAt` is epoch milliseconds taken
 * when the fingerprint was taken, just before branchling was spawned: the
 * answer reflects the backlog at least as of then. A hit returns the SAME
 * `answeredAt` (and the same deeply frozen envelope) as the spawn that
 * produced it, never the time of the hit. Views (UI-3, UI-4) show it as "as
 * of". The key is the method name plus JSON of its arguments.
 *
 * Errors (refusals, usage errors, contract mismatches) are never cached: the
 * entry is dropped when the spawn rejects. Identical reads made while one is
 * in flight under the same fingerprint share that one spawn. `version` passes
 * through uncached, and so do `where`, `doctor` and `check`. Every other method (`raw` and any future write) passes
 * through and bumps a local generation before and after it runs, so a write
 * made through this object can never be answered around.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

/** Timestamps younger than this (ms) are too close to "now" to be trusted. */
export const RACY_MS = 2000;

/** The adapter methods whose answers are cached. */
export const CACHED_READS = ["query", "stats", "plan", "show", "log", "deployStatus"];

/**
 * Methods that pass through without invalidating: they do not change a backlog.
 * `doctor` and `check` (UI-28) are reads, so treating them as writes would
 * throw away every other view's cached answer on each health read. They are
 * not cached either: they judge more than the fingerprint sees (git hooks,
 * AGENTS.md and docs/ at the repository root, skills in the user's home), so
 * a hit could be stale. Running both over a fixture was checked to leave
 * every file under the backlog directory unchanged (branchling 0.2.0).
 * `where` (UI-38) names directories and creates nothing (`branchling where
 * --help`); its answer depends on the working directory and the environment,
 * which the fingerprint does not see, so it is not cached either.
 */
const PASSTHROUGH_READS = ["version", "where", "doctor", "check"];

function git(args, cwd) {
  return new Promise(resolvePromise => {
    execFile("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      // A failure is part of the fingerprint, not an exception: a directory
      // outside any repository is a valid, stable state.
      resolvePromise(err ? { ok: false, out: `git-failed:${err.code}` } : { ok: true, out: stdout });
    });
  });
}

/** Metadata of every entry under `root`, sorted by path; null if absent. */
async function walk(root) {
  const rows = [];
  let newestNs = 0n;
  async function visit(abs) {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT" || err.code === "ENOTDIR") return;
      throw err;
    }
    await Promise.all(entries.map(async entry => {
      const path = join(abs, entry.name);
      let st;
      try {
        st = await lstat(path, { bigint: true });
      } catch (err) {
        // Deleted between readdir and lstat: the listing already differs.
        if (err.code === "ENOENT") { rows.push(`${relative(root, path)}\tgone`); return; }
        throw err;
      }
      const type = st.isDirectory() ? "d" : st.isSymbolicLink() ? "l" : "f";
      rows.push([relative(root, path), type, st.size, st.ino, st.mtimeNs, st.ctimeNs].join("\t"));
      for (const ns of [st.mtimeNs, st.ctimeNs]) if (ns > newestNs) newestNs = ns;
      if (type === "d") await visit(path);
    }));
  }
  let top;
  try {
    top = await lstat(root, { bigint: true });
  } catch (err) {
    if (err.code === "ENOENT") return { rows: ["absent"], newestNs };
    throw err;
  }
  rows.push(["", "root", top.ino, top.mtimeNs, top.ctimeNs].join("\t"));
  for (const ns of [top.mtimeNs, top.ctimeNs]) if (ns > newestNs) newestNs = ns;
  await visit(root);
  rows.sort();
  return { rows, newestNs };
}

function worktreePaths(porcelain) {
  return porcelain.split("\n").filter(l => l.startsWith("worktree ")).map(l => l.slice(9));
}

async function canonical(path) {
  try { return await realpath(path); } catch { return resolve(path); }
}

/**
 * The default change source: a stat walk of the backlog directory (and of the
 * same directory in sibling worktrees) plus git's refs and worktree heads.
 */
export function createFileChanges({ dir, cwd, racyMs = RACY_MS, now = Date.now } = {}) {
  if (!dir) throw new TypeError("createFileChanges needs the backlog `dir`");
  const target = resolve(cwd || process.cwd(), dir);

  return {
    async token() {
      // The clock is read BEFORE looking. Read after the walk and git's three
      // spawns, a slow look (a loaded machine, git at 0.6 s a call) made a
      // file written just before it look older than it was when seen, and a
      // racy state was vouched for (UI-32).
      const lookedAt = now();
      const backlog = await canonical(target);
      const [own, top, trees, refs] = await Promise.all([
        walk(backlog),
        git(["rev-parse", "--show-toplevel"], backlog),
        git(["worktree", "list", "--porcelain"], backlog),
        git(["for-each-ref", "--format=%(objectname) %(refname)"], backlog),
      ]);
      const parts = [own.rows.join("\n"), trees.out, refs.out];
      let newestNs = own.newestNs;
      if (top.ok && trees.ok) {
        const ownTop = await canonical(top.out.trim());
        const rel = relative(ownTop, backlog);
        for (const tree of worktreePaths(trees.out)) {
          if ((await canonical(tree)) === ownTop) continue;
          const other = await walk(join(tree, rel));
          parts.push(`@${tree}\n${other.rows.join("\n")}`);
          if (other.newestNs > newestNs) newestNs = other.newestNs;
        }
      }
      // Too recent to trust: a second write in the same tick would not show.
      if (newestNs > BigInt(Math.floor(lookedAt - racyMs)) * 1_000_000n) return null;
      return createHash("sha256").update(parts.join("\n\0\n")).digest("hex");
    },
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/**
 * Wraps an adapter from `createAdapter`. Pass `{ dir, cwd }` (the same values
 * the adapter was given) for the default change source, or `{ changes }`.
 */
export function createCache(adapter, { dir, cwd, changes, now = Date.now } = {}) {
  const source = changes || createFileChanges({ dir, cwd });
  /** key -> { token, promise } ; one entry per key, the latest one started. */
  const entries = new Map();
  let generation = 0;

  async function currentToken() {
    let token;
    try {
      token = await source.token();
    } catch {
      // A source that cannot look cannot vouch; branchling reports the real
      // problem (a missing directory, say) on the uncached call.
      token = null;
    }
    return token === null ? null : `${generation}:${token}`;
  }

  async function read(method, args) {
    const key = method + JSON.stringify(args);
    const startGeneration = generation;
    const answeredAt = now();
    const token = await currentToken();
    if (token !== null && generation === startGeneration) {
      const entry = entries.get(key);
      if (entry && entry.token === token) {
        const { envelope, answeredAt: at } = await entry.promise;
        return Object.freeze({ envelope, answeredAt: at, fromCache: true });
      }
    }
    const promise = adapter[method](...args).then(envelope => ({ envelope: deepFreeze(envelope), answeredAt }));
    if (token !== null && generation === startGeneration) {
      const entry = { token, promise };
      entries.set(key, entry);
      promise.catch(() => { if (entries.get(key) === entry) entries.delete(key); });
    }
    const { envelope } = await promise;
    return Object.freeze({ envelope, answeredAt, fromCache: false });
  }

  const cache = {};
  for (const [name, fn] of Object.entries(adapter)) {
    if (typeof fn !== "function") continue;
    if (CACHED_READS.includes(name)) {
      cache[name] = (...args) => read(name, args);
    } else if (PASSTHROUGH_READS.includes(name)) {
      cache[name] = fn;
    } else {
      cache[name] = async (...args) => {
        generation++;
        try { return await fn(...args); } finally { generation++; }
      };
    }
  }
  /** Drops every entry; the next read of each key spawns. */
  cache.clear = () => { generation++; entries.clear(); };
  return Object.freeze(cache);
}

/**
 * Joins a cache to the server (UI-3). `createCache` resolves its reads to
 * `{ envelope, answeredAt, fromCache }`, while view handlers and createServer
 * work with adapter-shaped methods that return envelopes. This returns
 *
 *   { forRequest() -> { adapter, answeredAt() } }
 *
 * which the server calls once PER REQUEST. That scope's `adapter` has the
 * cache's methods, its cached reads unwrapped to the bare (frozen) envelope,
 * and `answeredAt()` gives the OLDEST `answeredAt` among the reads this one
 * request made (epoch ms), or null if it made none. The response is at least
 * as fresh as that, and the server sends it as X-Branchling-UI-Fetched-At.
 * Nothing is shared between scopes, so concurrent requests cannot read each
 * other's times.
 *
 * Not stale: a hit means nothing observable changed since the answer was
 * computed (see the header of this file), so a cached answer is as current as
 * a spawned one. The architecture's "stale" (a remembered answer served while
 * a fresh read is on its way) is never produced here.
 */
export function servedFromCache(cache) {
  return Object.freeze({
    forRequest() {
      const times = [];
      const adapter = {};
      for (const [name, fn] of Object.entries(cache)) {
        if (typeof fn !== "function") continue;
        adapter[name] = CACHED_READS.includes(name)
          ? async (...args) => {
            const answer = await fn(...args);
            times.push(answer.answeredAt);
            return answer.envelope;
          }
          : fn;
      }
      return Object.freeze({
        adapter: Object.freeze(adapter),
        answeredAt: () => (times.length ? Math.min(...times) : null),
      });
    },
  });
}
