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
src/request-error.mjs        RequestError: a request answered with a 4xx before branchling runs
src/views/index.mjs          the view registry: one import and one entry per view
src/views/<view>.mjs         a view's API routes
src/view-model/<view>.mjs    the shared view model, pure functions
src/view-model/states.mjs    loading, error, refusal and unreachable states
src/view-model/roles.mjs     status and priority colour roles
src/web/                     the page: index.html, app.mjs, one module per view, styles.css, icons.svg
bin/branchling-ui-tui.mjs    starts the terminal interface (TUI) for one backlog
src/tui/terminal.mjs         colour and screen capabilities, the full-screen lifecycle
src/tui/render.mjs           a view model as lines of text, a pure function; KEYS
src/tui/text.mjs             segments, fitting, wrapping and painting a line
src/tui/screens/             one module per screen (stats, plan, release, decisions)
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

and is listed once in `src/views/index.mjs`. A handler of a non-GET route
also receives the parsed request `body`. A handler returns the JSON body,
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
| `RequestError` (`src/request-error.mjs`, thrown by the server or a handler, not the adapter) | 400, 413, 415 | `bad-request`, `payload-too-large`, `unsupported-media-type` |
| `BranchlingRefusal` | 409 | `refusal`, with `refusalKind` and the `envelope` |
| `ContractMismatch` | 502 | `contract-mismatch` |
| `BranchlingUsageError` | 500 | `usage-error` |
| anything else | 500 | `internal` |

A handler that refuses a request before calling the adapter (a missing or
malformed parameter) throws `RequestError` from `src/request-error.mjs`:
`400 bad-request` by default, any 4xx allowed, and no spawn.

A name the user typed (a release, a target, a stage) that branchling rejects
is the user's to fix, not this package's bug. Until branchling answers it with
a refusal envelope (it prints stderr only, exit 2), a handler wraps such a call
in `rejectingTypedInput` (same module): a usage error on a call that carried
typed names becomes `422 rejected-input` with `input`, `declared` (per
parameter, from branchling's own JSON, `null` when not known) and branchling's
message verbatim as `detail`. The view model's `rejected` state names the
undeclared name and lists the declared ones. A usage error on a call with no
typed name stays `500 usage-error` (UI-21).

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

The check is in `src/server.mjs` (`isAllowedWrite`) and runs on every request
that is not a GET (UI-5's `POST /api/decide` is the first route behind it):

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

**Request bodies.** Only after the guard has passed, the server reads the body
of a non-GET route once, for every route alike (`readJsonBody`):
`application/json` only (else 415), at most `MAX_BODY_BYTES`, 16 KiB (else
413, and the connection is closed), valid JSON (else 400). The handler gets it
as `body` and checks its shape itself, throwing a `RequestError` (400) for a
malformed one before any branchling command runs.

## The page: one design system, an app shell, a view per screen (UI-25)

**The design system.** The page is drawn with "Ledger", documented in
`docs/design/` (tokens, components, icon sprite, mockups of every screen).
`src/web/styles.css` is `docs/design/tokens.css` and `components.css` copied,
followed by the rules that put each view's markup on the system;
`src/web/icons.svg` is `docs/design/icons.svg` copied. A token or component
changes in `docs/design/` first, then is copied. Every semantic colour is one
`light-dark(light, dark)` declaration on `:root`, so the scheme follows
`prefers-color-scheme` and a dark value cannot be forgotten.
`.agents/skills/ui-verify/contrast.mjs` resolves those declarations (and the
older separate dark block, should one come back) and checks every pair the
views use, in both schemes.

**Moving between views.** Which view is on screen is `?view=` in the URL,
read once on load by `src/web/app.mjs`: the other sections are `hidden` and
only the current view's module is imported. The navigation is the app shell
of the mockups (`docs/design/mockups/shell.js`): a `<header>` holding the
brand, the backlog directory and a `<nav aria-label="Views">` of four real
links (`?view=overview`, `tasks`, `plan`, `release`, `decisions`, `health`),
the current one marked `aria-current="page"`; no `view` is the overview
(UI-29). A link is a full page load, so Back, reload and a
shared link show the same screen with no history code, and each view keeps
the URL parameters it owns (`&task=`, `&target=`, `&release=`). From 64rem up
the header is the sidebar; below it, the same header is a band above the page
with the four links in one row that wraps. Plain HTML and CSS: no script and
no dependency.

Rejected:

- **The mockups' phone drawer** (a menu button that slides the sidebar in).
  With four views the links fit in one row at 375 px, so a drawer would only
  hide them behind a button, and it needs a script, focus management and an
  Escape handler that the band does not.
- **Switching views in place** (`pushState` and showing another section
  without a load). It saves one page load (the shell and modules are tiny
  next to the ~500 ms read each view makes anyway) but every view would have
  to start, stop and re-read on `popstate`, which none is written for.
- **Stacked sections on one scrolling page** (the state before UI-3): each
  view fetches on start, so four views on one page would run every read at
  once, and the screen a link names would not be the screen shown first.
- **A tab bar** (`role="tablist"`). Tabs promise panels that switch in place
  with arrow keys; these are separate screens with their own URLs, which is
  what links and `aria-current` say.

Not in the shell yet: the mockups' top bar (search, the freshness indicator,
the scheme switch) and the count badges on the links. Each needs data or a
setting the page does not have: the decisions count alone costs one spawn
per active task (see the decisions view) on every screen.

## The decisions view (UI-5)

**Data.** branchling 0.2 has no command that lists open questions across
tasks. It defines an open question as one no decision points at, computed from
a task's log, and `log <ID> --decisions --json` is the read it names for that.
So `listDecisions(adapter)` in `src/adapter.mjs` composes one answer from
`query --json` (the active tasks, branchling's own default scope) plus one
`log <ID> --decisions` per task, four at a time. It takes the server's
per-request scope, so each of those reads goes through UI-2's cache and is
covered by `X-Branchling-UI-Fetched-At`; `adapter.decide()` is a write, which
the cache passes through and which invalidates every cached answer. No status name is used: no command reports which
statuses mean "waiting for somebody" (`reason_required_statuses` minus the
archived ones, inside branchling), and a task can carry an open question in
any status. The cost is one spawn per active task (about 0.45 s each, so
about 1.5 s for a dozen tasks); the upstream command that lists every open
question would make it one. `log --decisions --json` does not report a
question's options or recommendation yet, so the page offers a free-text
answer until it does; the view model reads options when they appear, under the
names `ask --json` uses. `resume --json` does carry them but was rejected: it
briefs a successor on one task, may refuse a task somebody else holds, and
runs the task's verification unless told not to.

**The write.** `POST /api/decide` takes `{ id, resolves, choose }` or
`{ id, resolves, reason }` and runs `branchling decide` through
`adapter.decide()`. A refusal (an unknown event, an option out of range)
comes back as the usual 409 with branchling's text unchanged and its detail
lines in `envelope.details`. Since 0.3.0, `decide --json` prints the usual
envelope (`kind: "task-decide"`); the adapter reads it like any other write
and also fails with a contract mismatch on a success that carries no recorded
decision. 0.2's bare object, with no `schemaVersion`, is refused.

**The actor.** The page cannot authenticate anybody, so the server never
passes `--actor` and refuses a body that names one. branchling resolves the
actor itself, in its own order: `$BACKLOG_ACTOR` in the environment of the
person who started the server, then the `actor:` in their branchling user
config, then branchling's default, `agent:claude`. The answer shows the actor
branchling recorded, so a person who has configured neither sees that their
answer was attributed to the default. Rejected: an actor typed on the page
(anybody with the tab open could claim to be anybody); a `--actor` flag on
`bin/branchling-ui.mjs` or a variable of this package's own (a second way to
say what `$BACKLOG_ACTOR` and the user config already say, and one more place
for the two to disagree). branchling cannot yet be told to refuse when it
falls back to its default actor; that is an upstream gap.

## The task panel's actions (UI-30)

The panel offers Take, Return to queue and Hand off, each one branchling
command through a typed adapter call (`take`, `release`, `handoff`, envelope
kinds `task-take`, `task-release`, `task-handoff`) and a POST route in
`src/views/task.mjs` (`/api/task/take`, `/release`, `/handoff`) behind the
write guard. They follow the decisions view's rules: the body is checked by
`validateTaskAction` (`src/view-model/task-actions.mjs`, shared with the page)
before anything spawns; only `id`, `reason` and `role` exist, an `actor` is
refused by name, and `take-over`, `probe`, `with`, `to-owner`, `status` or any
other field is unknown. A take-over crosses somebody else's claim and is left
to the CLI. No `--actor` is passed. The answer is branchling's envelope
unchanged, and the page shows the actor branchling recorded: `take`'s lock,
`handoff`'s comment, and for `release`, whose envelope names nobody, the
history exchange that carries its comment id. Each opens a confirmation (a
second modal `<dialog>`) that names the command and asks for its reason (and
role); a refusal is shown in it unchanged, with its detail lines.

**Roles.** No read of branchling 0.2 reports the declared `roles:`, so the role
is typed. An undeclared one is exit 2 with stderr only, which the route turns
into `422 rejected-input` (`declared: null`) with branchling's message, which
names the roles, verbatim. **Freshness.** The cache treats the three calls as
writes, so the panel's re-read right after one spawns again.

## The overview (UI-29)

The default screen: no `view` (or one not listed) is the overview. It answers
two questions, after `docs/design/mockups/overview.html`: what needs a person
(open questions, failing setup checks, tasks waiting on other tasks) and
where the backlog stands (the active wave and what may start now, what is in
flight, the totals). Each part links to the view that has the detail.

**Its reads are the existing routes, fetched in parallel by the page.** The
page reads `/api/stats`, `/api/plan`, `/api/health/doctor`, `/api/decisions`
and `/api/plan/tasks` (`OVERVIEW_READS` in `src/view-model/overview.mjs`) at
once and rebuilds the model as each answers; there is no overview route and
no new adapter call. `overviewPart()` turns one response into a part (its
envelope, or the server's own JSON error for that route), and
`overviewModel(parts)` builds six parts, each with its own state: a part is
`loading` until the reads it is built from have answered, and a failed read
turns only the parts built from it into `error` or `refusal`. Rejected: one
composed `GET /api/overview` settling the reads with `Promise.allSettled`.
It would make every part wait for the slowest read, and `doctor`, which the
cache does not hold, is that read: about 1.4 s on an idle machine and 12 s
measured with the test suites of other worktrees running, while a cached
`stats` answers in about 0.1 s. That is the reason the health view (UI-28)
gave each section its own route; a composed route would also have needed
the server's error mapping inside a view module. The cost of parallel
reads: `query` is asked twice (by `/api/decisions` and `/api/plan/tasks`),
which UI-2's cache answers once when nothing changed, and five
`X-Branchling-UI-Fetched-At` headers, of which the page shows the oldest.

**Where each number comes from**, never from a status name (UI-18): open
questions from the decisions answer; failing checks from doctor's `error`
rows; "waiting on other tasks" from stats `blocked`, which in branchling 0.2
counts ACTIVE tasks whose `blocked_by` is not empty (`summarize` in
branchling's stats; its text report calls it "waiting on other tasks"). It is
not the status named `blocked`: `ask` sets that status without a
`blocked_by`, and a task with a `blocked_by` keeps its own status, so the two
numbers differ (the fixture has one of each), and the overview labels the
count by what it is. In flight is the task list's rows whose status is the
plan's `inProgressStatus`, the name branchling itself gives that state, so it
covers unplanned tasks too; the totals and distributions are `statsModel`'s.

**The stats view folds into the overview.** The mockup's overview carries
the stats view's totals and its by-status and by-priority counts, and the
mockup's navigation has no Stats entry, so the nav link that said Stats now
says Overview. `?view=stats` still shows the stats view (its section is in
the page, hidden, and `app.mjs` lets that one address through) so an old
link keeps working and the terminal's stats screen keeps its web
counterpart; the nav no longer offers it.

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
key map (`1 stats  2 plan  3 release  4 decisions  tab next  j/k scroll
r refresh  q quit`). `1` to `4` show a screen and Tab the next one (UI-31);
`j` and `k` scroll a screen taller than the terminal; `q` quits; Ctrl-C quits
too, because raw mode delivers it as a key, not as SIGINT; `r` reads again.
An escape sequence (arrows, function keys) is ignored until a screen needs
it. A new key goes into `KEYS` in `src/tui/render.mjs` with the characters
that press it, so it cannot be bound without appearing in the key map.

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
and title the server's JSON error gives the page. Since UI-20 the entry wraps
the adapter through `prepareAdapter` (`src/tui/start.mjs`) in UI-2's cache,
using the same join as the server: `servedFromCache(cache).forRequest()`, one
scope per refresh, since a bare cache resolves to `{ envelope, answeredAt,
fromCache }`, not to envelopes. It checks the branchling version first; an
unsupported version is a warning on stderr, as in the web entry, printed
before the alternate screen is taken. The scope's `answeredAt()` becomes the
model's `fetchedAt`; "stale" on screen still means only that a refresh is in
flight, since a cache hit is never stale.
