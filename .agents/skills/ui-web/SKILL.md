---
name: ui-web
description: Build or change a screen of the branchling-ui web interface. Covers the local server (src/server.mjs), the view registry (src/views/), the shared view model (src/view-model/), the page (src/web/), design tokens for light and dark, status and priority colour roles, the loading, empty, error, refusal and stale states, view state in the URL, the loopback and write guard, WCAG 2.2 AA and keyboard use. Use this skill whenever work adds or changes a view, a route, a page, a style, a colour or a state message, and for requests like "add a plan view", "show the release pipeline", "make this screen work in dark mode", "the page should show X", "add a button that does Y" — even if the word web never comes up.
---

# How a screen is built in branchling-ui

The decisions behind this are in `docs/architecture.md`; read it before
changing any of them. In short: a zero-dependency `node:http` server bound to
127.0.0.1, one page, native ES modules, no framework and no build step. Data
comes only from `src/adapter.mjs` (the `ui-adapter` skill covers adding a
call). Never add a runtime dependency.

## The four pieces of a view

1. **The adapter call.** If the data is not available yet, follow the
   `ui-adapter` skill first. A view never uses `adapter.raw`.
2. **The route**, in its own module `src/views/<view>.mjs`:

   ```js
   export default {
     id: "plan",
     routes: [{ method: "GET", path: "/api/plan", handler: ({ adapter }) => adapter.plan() }],
   };
   ```

   Then one import and one entry in `src/views/index.mjs`, alphabetical. That
   is the only shared file a view touches. A handler returns the envelope
   unchanged, or throws the adapter's error; the server maps errors to JSON
   (refusal 409, contract mismatch 502, usage error 500). Never catch an
   error to return an empty result.
3. **The view model**, `src/view-model/<view>.mjs`: pure functions from the
   envelope (plus `freshness`) to plain data. No HTML, no ANSI, no colour
   values, no `node:` imports, no DOM, no I/O; it imports only `./x.mjs`
   siblings, because the browser loads it from `/view-model/` and the
   terminal interface (UI-16) imports it from Node. Every decision a surface
   would otherwise make (counts, labels, ordering, which state applies) goes
   here, so the two surfaces cannot drift. Test it in
   `test/view-model.test.mjs` without a server, including the check that no
   string contains `<` markup or `\x1b`.
4. **The rendering**, in `src/web/`: build nodes with DOM APIs and put text
   in with `textContent`. Never `innerHTML` with data; the CSP forbids inline
   scripts anyway.

## Design tokens

The design system is "Ledger", documented in `docs/design/` (open
`design-system.html` through a static server, the `design-mockups` entry of
`.claude/launch.json`; mockups of every planned screen are in
`docs/design/mockups/`, and a view is built after its mockup). `src/web/styles.css` is a copy of
`docs/design/tokens.css` and `components.css`, followed by the rules that
map this page's own markup onto it. Change a token or a component in
`docs/design/` first, then copy it, so the documentation stays the truth.

Views use only the semantic custom properties (`--color-bg-surface`,
`--color-text-muted`, `--color-action-primary`, `--role-<role>-bg`…), never
a primitive (`--n-500`, `--teal-600`) and never a literal colour. Each
semantic token is one `light-dark(light, dark)` declaration, so the dark
scheme cannot drift from the light one. Adding a token, or using two tokens
together in a new way, means adding the pair to
`.agents/skills/ui-verify/contrast.mjs` (it checks both schemes) and to
`docs/design/contrast-pairs.json`. The page's CSP forbids `style`
attributes: a computed size (a meter's width) is set through
`element.style`, never through markup.

## The app shell and a new view

The page is the shell of the mockups (docs/architecture.md, "The page"): a
`<header class="sidebar">` with the brand, the backlog directory and
`<nav aria-label="Views">`, then `<main class="page">` with one
`<section data-view="<id>" hidden>` per view. A new view adds, in one change:
its section in `src/web/index.html`, its link in the nav (an icon from
`src/web/icons.svg`, a real `href="?view=<id>"`), and its one line in
`VIEW_MODULES` in `src/web/app.mjs`. A link is a page load, so the view state
in the URL is the whole state.

## Colour roles

Statuses and priorities get a **role** (`role` in the view model, class
`role-<role>` on the page, `--role-<role>-bg/-fg/-dot` tokens), never a
colour. Six roles are styled: `neutral`, `progress`, `attention`, `danger`,
`success`, `muted` (their meaning is on the design-system page).
**Every status and priority is `neutral` until UI-18** brings the status and
priority vocabulary from the CLI as JSON. The UI may not read config.yaml,
and guessing from key names (`done` is green) would colour a custom or
renamed status wrongly in someone else's backlog. When UI-18 lands, the
functions in `src/view-model/roles.mjs` take the vocabulary as an argument.
Colour is never the only signal: the label is always shown.

## The states every view has

| State | When | What the page shows |
|---|---|---|
| `loading` | before the first answer | a status message; the region has `aria-busy="true"` |
| `empty` | the answer is valid and has no rows | a plain sentence saying so, not an error |
| `error` | contract mismatch, usage error, unreachable server | title and detail from `states.mjs`, a Try again button |
| `refusal` | branchling declined (`BranchlingRefusal`) | the refusal text and its `refusalKind`; it is an answer the user may act on |
| stale | `freshness.stale`: a remembered answer served while a fresh read is on its way (a cache hit is NOT stale; see docs/architecture.md) | the data, plus a notice that a fresh read is on its way |

Build them with `src/view-model/states.mjs` so the terminal says the same
thing. A refusal must never look like an empty list.

## View state in the URL

Whatever selects what is on screen (the view, a filter, the open task, a
sort) lives in the URL query (`?view=plan&status=blocked&task=UI-3`), read on
load and written with `history.replaceState` (or `pushState` for a change
the Back button should undo). A reload or a shared link shows the same
screen. Nothing of that is kept only in memory or `localStorage`.

## The loopback guard and writes

`src/server.mjs` refuses any request whose `Host` is not
`127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`. A view does not
repeat or weaken that. For a write (UI-5, UI-6):

- register the route with a non-GET method; the server already requires the
  matching `Origin` and the capability token for every non-GET request;
- send the token from the page: `import { capability } from "/app.mjs"` (or
  read `meta[name="branchling-ui-capability"]`) in the
  `X-Branchling-UI-Capability` header, with `Content-Type: application/json`;
- the handler calls an adapter method that runs a branchling command. The
  server never writes a task file, and a missing command is an upstream task.

Server tests go in `test/server.test.mjs` against the real executable over a
fixture backlog in a temporary directory, through `node:http` (fetch cannot
set `Host`). A guard test's name contains the word "host".

## Accessibility: WCAG 2.2 AA and the keyboard

- Text contrast at least 4.5:1 (3:1 for large text, borders and focus
  indicators), in both light and dark.
- Everything works with the keyboard alone, in a logical tab order. Use real
  `<button>` and `<a href>` elements; nothing clickable is a bare `<div>`.
- A visible focus indicator on every focusable element (`:focus-visible`
  uses `--focus`), never hidden by sticky content (WCAG 2.4.11).
- Target size at least 24 by 24 CSS pixels (2.5.8).
- Landmarks and headings: one `<h1>`, a `<main>`, sections with headings,
  data in `<table>` with `<th scope>`; a skip link stays first.
- Loading and results update a region with `aria-live="polite"`; errors and
  refusals use `role="alert"`.
- Honour `prefers-reduced-motion` and `prefers-color-scheme`.
- Check a new screen with the keyboard only, in both colour schemes, at 200%
  zoom and at phone width.

## Cost

Each adapter call takes about 500 ms. A view fetches its list once, never
per row, and leaves room for UI-2's cache: render the stale state, do not
block the page on a second call.
