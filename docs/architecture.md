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
src/views/index.mjs          the view registry: one import and one entry per view
src/views/<view>.mjs         a view's API routes
src/view-model/<view>.mjs    the shared view model, pure functions
src/view-model/states.mjs    loading, error, refusal and unreachable states
src/view-model/roles.mjs     status and priority colour roles
src/web/                     the page: index.html, app.mjs, styles.css
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
  `{ stale, fetchedAt }`. Until UI-2 every answer is fresh; the field exists
  now so no surface changes when the cache arrives.
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

The guard answers `403 forbidden`; an unknown path `404 not-found`; a method
with no route `405 method-not-allowed`.

## The cache seam (UI-2)

`createServer({ adapter })` takes any object with the adapter's methods.
UI-2's cache wraps `createAdapter(...)` with the same interface and is passed
in its place; no view and no handler changes. When it serves a remembered
answer, it reports that through the response headers
`X-Branchling-UI-Stale: 1` and `X-Branchling-UI-Fetched-At: <ISO time>`, which
the page already reads into the model's `freshness`. How the cache passes that
to the server (for example a `freshness` property next to the envelope) is
UI-2's to design.

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
