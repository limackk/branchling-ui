# Architecture

How branchling-ui is shaped, and why. Every view task builds on the choices
recorded here (UI-1). Change one only on purpose, in a task that says why.

## The constraints the choice had to meet

- **The adapter is the only door.** `src/adapter.mjs` spawns the installed
  `branchling` with `--json`; nothing else spawns it or reads a backlog file.
- **The interface never writes a task file.** Every write is a branchling
  command run through the adapter.
- **Any repository.** It points at whatever backlog `branchling` finds
  (`--dir`, else the current directory), not at this repository's.
- **Zero runtime dependencies.** A maintainer decision, enforced in CI
  (`.github/workflows/test.yml`). branchling's own viewer (`branchling serve`)
  sets the same precedent: `node:http`, one page, no framework, no build.
- **A `branchling` call costs about 500 ms** (measured for UI-2), so startup
  and every view must leave room for UI-2's cache and its stale state.

## Decision: a local `node:http` server, no framework, no build step

`bin/branchling-ui.mjs` starts `src/server.mjs`, bound to `127.0.0.1`, which
serves one HTML page, its native ES modules, and a JSON API. The page fetches
envelopes from the API and renders them with plain DOM APIs.

### Options compared

| | Local `node:http` server + static ES modules (chosen) | Desktop shell (Electron, Tauri) | Framework + bundler (React or Preact with Vite) |
|---|---|---|---|
| Runtime dependencies | none | Electron: ~100 MB runtime per install; Tauri: a Rust toolchain and a native build per platform | the framework at least; usually a router and more |
| Build step | none: the files in `src/` are what the browser loads | packaging per OS, code signing | required; output must be built before every run and test |
| Startup cost | Node starts in well under 100 ms; the first `stats` call (~500 ms) dominates | seconds for the shell, then the same ~500 ms call | same as the server, plus the bundle; dev server startup in development |
| Adapter as the only door | yes: the server is the one Node process that calls it | yes, from the main process, but there are now two processes and an IPC contract to keep | yes, but only with a server anyway; a bundler adds nothing here |
| Works on a backlog in any repository | yes: `--dir` or the current directory | yes, but needs a folder picker and installs per machine | yes |
| Fits the CI matrix (Node 18 to 22, three OSes) | runs as is | a separate build matrix | runs after a build |
| Precedent | `branchling serve` works this way | none in branchling | none in branchling |

**Rejected: a desktop shell.** It brings a large runtime or a native
toolchain, a second process with its own IPC contract, per-OS packaging and
signing, and all of that for a window that a browser tab already gives us.
Nothing in the backlog needs native access the browser lacks.

**Rejected: a framework with a bundler.** It breaks the zero-dependency rule
outright, adds a build that every run and every test must wait for, and buys
mostly component ergonomics. The views planned (stats, plan, release,
decisions) are lists and tables over data the view model already shapes. If a
view ever needs reactivity beyond `replaceChildren`, that is a decision to
take again with evidence, not a default.

### What the decision costs

- No JSX and no component library: views are written with a small `el()`
  helper and DOM APIs. Text goes in through `textContent` only.
- No bundler means no TypeScript; types are JSDoc where they help.
- Browser support is whatever runs native ES modules and CSS custom
  properties, which every current browser does.

## Layout

```
bin/branchling-ui.mjs        starts the server for one backlog, prints the URL
src/adapter.mjs              the only door into branchling (unchanged by UI-1)
src/server.mjs               HTTP, the loopback guard, static files, the route table
src/cache.mjs                UI-2's read cache, and servedFromCache, its join to the server
src/request-error.mjs        RequestError: a handler's 4xx before any spawn
src/views/index.mjs          the view registry: one import and one entry per view
src/views/<view>.mjs         a view's API routes
src/view-model/<view>.mjs    the shared view model, pure functions
src/view-model/states.mjs    loading, error, refusal and unreachable states
src/view-model/roles.mjs     status and priority colour roles
src/web/                     the page: index.html, app.mjs, styles.css
bin/branchling-ui-tui.mjs    starts the terminal interface (TUI) for one backlog
src/tui/terminal.mjs         colour and screen capabilities, the full-screen lifecycle
src/tui/render.mjs           a view model as lines of text, a pure function
src/tui/app.mjs              the TUI loop: fetch, redraw, keys, signals
```

## The view registry

Each view is its own module in `src/views/` that default-exports

```js
export default {
  id: "plan",
  routes: [{ method: "GET", path: "/api/plan", handler: ({ adapter, url, params }) => adapter.plan() }],
};
```

and is listed once in `src/views/index.mjs`. A handler returns the JSON body,
usually the adapter's envelope unchanged, or throws one of the adapter's
errors. It never spawns anything, touches the file system or writes the
response itself. The server builds one route table from the registry at
startup and refuses to start if two views register the same method and path.
Views developed in parallel (UI-3 plan, UI-4 release, UI-5 decisions) meet in
two lines of `src/views/index.mjs` and nowhere else.

## The shared view model

Both surfaces, this web page and the terminal interface (UI-16), render the
same **view model**: plain data computed from adapter envelopes by pure
functions in `src/view-model/`. It holds numbers, strings, booleans, arrays
and plain objects. It holds no HTML, no ANSI escape codes, no colour values
(only role names) and no I/O, so the two surfaces cannot drift: a count, a
label, an empty state or a refusal is decided once, here.

- The modules import nothing but each other (`./x.mjs`): no `node:` module,
  no DOM. A test enforces it.
- **Where it runs.** The API sends the envelope as branchling printed it, and
  the browser builds the model itself: the server serves `src/view-model/` at
  `/view-model/` and the page imports it as native ES modules. The terminal
  imports the same files from Node. So the API stays a thin, testable door
  onto the adapter, and the model has one implementation, not a server copy
  and a client copy.
- Each builder takes the envelope plus a `freshness` argument,
  `{ stale, fetchedAt }`. `fetchedAt` is when branchling answered (the
  cache's `answeredAt`, see the cache seam below); `stale` marks a remembered
  answer shown while a fresh read is on its way, such as the TUI's last
  stats during a refresh. A cache hit is never stale.
- Every model has a `state`: `loading`, `empty`, `ready`, `error` or
  `refusal`, plus `freshness.stale`. A refusal is never turned into an empty
  result.
- Counts that depend on the vocabulary (`active`, `archived`, `blocked`)
  are taken from the envelope as branchling computed them, never derived
  from status names, until UI-18. A backlog with a custom archived status
  would otherwise get a wrong number.
- Status and priority roles are all `neutral` until UI-18. The vocabulary is
  in the backlog's config.yaml, which this package may not read, and no
  branchling command returns it as JSON yet (`stats --json` gives only the
  keys of `byStatus` and `byPriority`).

## The API and its errors

`GET /api/stats` answers with the adapter's `stats` envelope. Failures are
JSON, `{ "error": { "type", "message", ... } }`, with distinct statuses:

| Thrown by the adapter | HTTP | `error.type` |
|---|---|---|
| `BranchlingRefusal` | 409 | `refusal`, with `refusalKind` and the `envelope` |
| `ContractMismatch` | 502 | `contract-mismatch` |
| `BranchlingUsageError` | 500 | `usage-error` |
| anything else | 500 | `internal` |

A handler that refuses a request before calling the adapter (a missing or
malformed parameter) throws `RequestError` from `src/request-error.mjs`:
`400 bad-request` by default, any 4xx allowed, and no spawn.

The guard answers `403 forbidden`; an unknown path `404 not-found`; a method
with no route `405 method-not-allowed`.

## The cache seam (UI-2, joined in UI-3)

`createServer({ adapter })` takes any object with the adapter's methods, so a
handler stays `({ adapter }) => adapter.plan()` whatever sits behind it.

What UI-2 shipped (`src/cache.mjs`): `createCache(adapter, { dir, cwd })`
answers the reading calls (query, stats, plan, show, log, deployStatus) from
memory while a fingerprint of the backlog directory and git's refs is
unchanged, and resolves each to `{ envelope, answeredAt, fromCache }`, not a
bare envelope. `answeredAt` is when the answer was computed; a hit returns
the time of the spawn that produced it.

The join (UI-3): `servedFromCache(cache)` returns `{ forRequest() }`. The
server calls it once per request and hands the handler that scope's
`adapter`, whose reads return the bare envelope, then sends the oldest
`answeredAt` of that request's reads as `X-Branchling-UI-Fetched-At: <ISO>`.
Each request gets its own scope, so concurrent requests cannot mix up times.
A plain adapter (no `forRequest`) is served as before, with no header.

**A cache hit is not stale.** UI-2 serves from memory only when nothing
observable changed since the answer was computed, so a hit is as current as
a spawn and `X-Branchling-UI-Stale` is never set for it. Stale, in this
document, means a remembered answer served while a fresh read is on its way;
nothing produces that yet, and the page and model keep the field for when
something does.

`bin/branchling-ui.mjs` always serves through the cache. The cache needs the
backlog directory: with `--dir` that is it; without, it is the `root` of one
`stats --json` at startup (`where --json` names it more directly but prints
no `schemaVersion`/`kind` envelope, so the adapter cannot take it). If that
read fails, the server runs uncached and the views report the failure.

## The loopback guard

Binding to `127.0.0.1` is not enough on its own: any page open in the same
browser can reach a loopback port, and DNS rebinding makes a foreign origin
resolve to it. The guard follows `branchling serve`
(`scripts/serve-backlog.mjs`, read, never imported):

- **Every request** must carry a `Host` of `127.0.0.1:<port>`,
  `localhost:<port>` or `[::1]:<port>`, where `<port>` is the port actually
  bound. Anything else is refused with 403 before any route or file is
  served. A rebound name (`evil.example:<port>`) fails here.
- The server binds `127.0.0.1` (or `::1`), never a wildcard address.
- **A port already in use does not stop startup.** The server tries up to ten
  ports upward from the requested one (default 4322, one above
  `branchling serve`'s 4321), then lets the system pick one, and prints the
  address it got.
- The page is served with a strict Content Security Policy
  (`default-src 'self'`, no inline script), `nosniff`, `no-referrer` and
  `no-store`. Static files come from a table built at startup; a request path
  is never joined onto a directory.

### The write guard (for UI-5 and UI-6)

No route writes yet, but the check is already in `src/server.mjs`
(`isAllowedWrite`) and runs on every request that is not a GET:

1. `Host` passes the allowlist above;
2. `Origin` equals `http://<that Host>` exactly. A browser always sends it on
   a cross-origin or non-GET fetch, so a foreign page cannot forge it;
3. the header `X-Branchling-UI-Capability` equals the capability token, 32
   random bytes generated per server process and injected into the served
   page as `<meta name="branchling-ui-capability">` (the page exports it as
   `capability` from `src/web/app.mjs`). Only a page this server served can
   read it. Compared in constant time.

A request failing any of the three is refused with 403. A writing view adds
its route to the registry with `method: "POST"` (or another non-GET method);
it never implements its own check. The handler then calls an adapter method
that runs a branchling command; it never writes a file. If UI-5 needs
short-lived tokens as `branchling serve` has, the change belongs in
`src/server.mjs`, for every route at once.

## The terminal interface (TUI, UI-16)

The maintainer decided on 2026-11-02 that the terminal surface is an
interactive full-screen TUI, in the style of lazygit or k9s, not only
formatted command output. It holds to every rule above: the adapter is the
only door, nothing writes a task file, it works on any repository's backlog,
and it renders the shared view model, so a count or a refusal reads the same
in the terminal as on the page.

### Options compared

| | No dependency: `node:readline`, raw mode, ANSI escapes (chosen) | Ink (React for terminals) | A lower-level library (blessed, neo-blessed, terminal-kit) |
|---|---|---|---|
| Runtime dependencies | none | `ink` and `react`, the Yoga layout engine, and their transitive packages | blessed: one package, unmaintained for years; neo-blessed is a fork with little activity; terminal-kit: several packages |
| Windows support | Windows Terminal and the Windows 10+ console host take the same VT sequences; Node gives raw mode and a `resize` event on stdout on every platform | good, through the same Node primitives | blessed reads terminfo and has known gaps on the Windows console; terminal-kit does not promise Windows support |
| Startup cost | Node starts in well under 100 ms; the first `stats` call (~500 ms) dominates | React, the reconciler and Yoga load before the first frame | blessed parses terminfo at start; both are heavier than writing the screen ourselves |
| Adapter as the only door | yes: the TUI calls adapter methods and nothing else | yes | yes |
| Renders the shared view model | yes, a pure function from model to lines | yes, but through components and a second state layer around the model | yes, but through widgets that keep their own state |
| Testability | the renderer is a pure function; the loop takes fake streams and a fake process, so tests assert on bytes written and on raw mode | `ink-testing-library`, another dependency | needs a real or emulated terminal; widget state is hard to reach |
| Restore on every exit path | ours to write, and tested | Ink restores on its own exit, not on every crash path without help | blessed restores on its own exit; a crash path still needs our handlers |
| Precedent | branchling has no runtime dependency | none | none |

**Rejected: Ink.** It breaks the zero-dependency rule enforced in CI and
brings a React runtime, a reconciler and a layout engine to draw
a few tables. Its component model would also put a second state layer on top
of the view model, which is the one place decisions are meant to live.

**Rejected: a lower-level library.** It breaks the same rule, and the
candidates are either unmaintained (blessed) or partial on Windows
(terminal-kit), which is part of the CI matrix. What they give, cursor
addressing and a key reader, is a few dozen lines on top of Node's raw mode.

### What the decision costs

- No widgets, no layout engine: each screen is a pure function from a model
  to lines, written by hand (`src/tui/render.mjs`).
- Width is counted in code points. A double-width character (CJK, most
  emoji) counts as one column, so a line holding one can overrun by a
  column. Backlog keys are usually ASCII; a width table is a later change if
  that stops being true.
- Terminals without VT sequences (the pre-2018 Windows console host) are not
  supported for the full screen. They still get the printed screen through
  `TERM=dumb` or a pipe.

### The keyboard model

Single keys, no modifiers, always shown on the last row of the screen as a
key map (`q quit  r refresh`). `q` quits; Ctrl-C quits too, because raw mode
delivers it as a key, not as SIGINT; `r` reads again. An escape sequence
(arrows, function keys) is ignored until a screen needs it. A new key goes
into `KEYS` in `src/tui/render.mjs`, so it cannot be bound without appearing
in the key map.

### The terminal rules

- **Colour per stream.** Off when `NO_COLOR` is set to any non-empty value,
  when `TERM=dumb`, or when that stream is not a TTY; stdout and stderr are
  checked separately.
- **NO_COLOR is about colour only.** On a terminal with `NO_COLOR` set, the
  TUI still takes the alternate screen and hides the cursor; it writes no SGR
  code.
- **The full screen needs a terminal.** When stdin or stdout is not a TTY,
  or `TERM=dumb`, the TUI prints the screen once, without the key map, and
  exits with 0 for data and 1 for an error or a refusal. Raw mode is never
  touched then.
- **The 16 ANSI colours only** (SGR 30 to 37, 90 to 97, bold, dim), so the
  user's theme decides what they look like. Statuses and priorities are
  styled by role, from `ROLE_STYLE`, never by name; every role is `neutral`
  until UI-18 brings the vocabulary from config.yaml through the CLI. A label
  is always shown; colour is never the only signal.
- **Restored on every exit path.** Alternate screen and hidden cursor on
  start; on quit, Ctrl-C, SIGINT, SIGTERM, SIGHUP, an uncaught exception, an
  unhandled rejection and process exit, the TUI leaves the alternate screen,
  shows the cursor and ends raw mode. Restoring is idempotent.
- **Resize** redraws from stdout's `resize` event, which Node emits on
  Windows as well; nothing relies on SIGWINCH.
- **Text from the backlog is data.** C0 and C1 control characters, ESC
  included, are replaced before anything reaches the terminal.
- **States.** Loading, empty, error, refusal and stale come from
  `src/view-model/`, as on the page. On `r` the last stats stay on screen,
  marked stale, until the new read answers.

The TUI calls the adapter directly, so it maps the adapter's errors with
`fromAdapterError` in `src/view-model/states.mjs`, which gives the same state
and title the server's JSON error gives the page. It does not use UI-2's cache
yet. When it should, it takes the cache through the same join as the server
(`servedFromCache(cache).forRequest().adapter`, one scope per refresh), since a
bare cache resolves to `{ envelope, answeredAt, fromCache }`, not to envelopes.
