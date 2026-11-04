# Design: the Ledger system and the screens

A design system and mockups of every screen of the branchling-ui web
interface. The page in `src/web/` is drawn with it (UI-25; see "In the app"
below).

Open it through any static server, for example:

```bash
python3 -m http.server 4390 --bind 127.0.0.1 --directory docs/design
```

then `http://127.0.0.1:4390/design-system.html` and `/mockups/index.html`.
The sprite is referenced by `<use href>`, which browsers do not load over
`file://`.

| File | What it is |
|---|---|
| `tokens.css` | the source of truth: primitives, semantic tokens, roles, type, space, shape, motion |
| `tokens.json` | the same tokens in W3C DTCG format; the dark value is in `$extensions["org.branchling.dark"]` |
| `components.css` | every component, using semantic tokens only |
| `icons.svg` | one icon sprite drawn for the product, so nothing is fetched |
| `contrast-pairs.json` | the 47 colour pairs checked, both schemes |
| `design-system.html` | the living documentation of all of the above |
| `mockups/` | nine screens on a fictional backlog, `harbor`; `shell.js` is a mockup-only shell |

## Brief, as assumed

The skill behind this asks for a brief first; it was compressed into
assumptions, so correct any that are wrong.

- **Who.** (1) A maintainer who drives a fleet of agents over the backlog and
  wants to see the plan, what is in flight and what is stuck. (2) A
  non-technical person who opens the interface mostly to answer a question an
  agent asked (UI-5 calls this the screen opened most).
- **Constraints, from docs/architecture.md.** Zero dependencies, no build,
  native ES modules, a strict CSP (`default-src 'self'`): no web fonts, no CDN,
  no inline script in the app. WCAG 2.2 AA in light and dark. Every write is a
  branchling command; status and priority colours come from the backlog's vocabulary (UI-18),
  neutral when the installed branchling cannot give it.
- **Tone.** A tool for work: calm, dense, exact. Not a marketing page.

## Principles

1. **branchling said it, we show it.** Counts, refusals and errors as the CLI
   gave them. A refusal never looks like an empty list.
2. **Every write names its command.** The dialog shows the exact `branchling`
   command and asks for the reason it requires.
3. **What needs a person comes first.** Decisions, tasks that may start now
   and failing checks are one glance from anywhere.
4. **Label first, colour second.** Text is always on screen; colour is a role.
5. **Dense, never cramped.** Tabular numbers, mono ids, one accent.

## Screens and their data

| Screen | Answers | CLI | Task |
|---|---|---|---|
| Overview | what needs me, where do we stand | `stats`, `plan`, `doctor`, `query`, `log --decisions` (the other views' routes) | UI-29 |
| Tasks | find and filter; filters live in the URL | `query` | — |
| Task panel | everything about one task, and its actions | `show`, `log`, `set`, `take`, `handoff`, `release`, `done` | UI-6 |
| Plan | waves, what may start now, unplanned, ahead of plan | `plan` | UI-3 |
| Releases | what waits for each stage, planned against shipped; declaring | `deploy status`, `declare`, `set … release` | UI-4, UI-8 |
| Decisions | questions waiting on a person, answered here | `log --decisions`, `decide` | UI-5 |
| Health | setup checks, release gate, divergent tasks | `doctor`, `check`, `show` | — |
| Write flows | edit, take, hand off, done, new, a refused write | the commands above | UI-6 |
| View states | loading, empty, stale, live off, refusal, errors, not found | `states.mjs` | UI-2, UI-7 |

Navigation: a sidebar with the six views (badges for waiting decisions and
failing checks), a top bar with search (<kbd>/</kbd>), the freshness
indicator and the scheme switch. The task panel opens over the list it came
from; its id is in the URL, Back closes it. Below 1024 px the sidebar becomes
a drawer; below 640 px tables fold into lists.

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-02 | System fonts, mono for ids, SHAs, refs and commands | the CSP forbids fetched fonts; the CLI vocabulary reads as something you could type |
| 2026-11-02 | One accent, teal, reserved for actions | if colour means "clickable", it cannot also mean a status; teal stays clear of the green success role |
| 2026-11-02 | Six colour roles (`neutral`, `progress`, `attention`, `danger`, `success`, `muted`), every value `neutral` until UI-18 | `roles.mjs` already maps values to roles; the palette is ready the day the vocabulary arrives, and no status is coloured by guessing at its name |
| 2026-11-02 | Status is a round pill with a dot, priority a square mono tag | the two must not be confused, also in greyscale |
| 2026-11-02 | Refusal amber, error red, stale blue | a refusal is an answer to act on, an error a fault, stale data still valid to read |
| 2026-11-02 | Every write dialog shows a command preview | principle 2; it also teaches the CLI |
| 2026-11-02 | People get round avatars, agents square ones | the history must make plain who acted |
| 2026-11-02 | `light-dark()` for every semantic token instead of a duplicated dark block | one line per token cannot drift between schemes; supported by every browser that runs the app |
| 2026-11-02 | Decision options: the recommended one is labelled, never preselected | preselecting would turn the agent's recommendation into the person's default answer |

## Not real yet

The mockups show the target, so a few things on them have no data source
today. Each one is either an upstream task or a small view-model computation:

- **"No change for 5 days"** and wait times per stage need history timestamps
  per task (`log`) or `deploy status`; confirm the envelope carries them.
- **Refusal kinds** shown (`not-holder`, `stale-reference`, `no-plan`) are
  illustrative; the real values are whatever `refusalKind` branchling sends.
- **Moving tasks between waves** waits on a `plan move` call in the adapter.
- **Live updates** (the "Live" indicator and its off state) wait on UI-7.
- **"Act as"** for writes needs an actor; where it comes from (a setting, the
  git user) is still open.

## In the app

`src/web/styles.css` is `tokens.css` and `components.css` copied, followed by
the rules that put the page's markup on the system: the app shell, then the
stats, plan, release and decisions views, each after its mockup.
`src/web/icons.svg` is `icons.svg` copied; the page uses it for the brand,
the view links and the plan's waves. Change a token, component or icon here
first, then copy it; the ui-web skill says the same. The roles are listed in
`ROLES` in `src/view-model/roles.mjs`, which maps the backlog's vocabulary to
them (UI-18) and falls back to `neutral` when it is not known.

The shell is the sidebar of `mockups/shell.js` from 64rem up. Below that it is
a band above the page with the four view links in one row, not the mockups'
drawer: with four views a drawer only hides them (docs/architecture.md, "The
page"). Not in the app yet: the top bar (search, the freshness indicator, the
scheme switch) and the count badges on the links, which need data the page
does not have; the drawer, tables folding into lists, the task drawer and the
write dialogs, which come with the views that need them (the plan's task
detail is still an inline panel).

Tokens added in the app's work, here first: `--state-recorded-bg/-fg/-border`
(an answer branchling recorded, UI-5), on the success role.

## Accessibility check

- Contrast: `contrast-pairs.json`, 47 of 47 pairs pass AA (script from the
  ux-ui-designer skill). For the app, `.agents/skills/ui-verify/contrast.mjs`
  reads the tokens from `src/web/styles.css` and checks every pair the views
  use, in both schemes.
- No horizontal scroll at 375 px on any screen; one `h1` per page; no
  duplicate ids; every control has an accessible name (checked in the
  browser).
- Still to check by hand once in the app: keyboard order and focus trap in
  the panel and dialogs, 200% zoom, a screen reader pass.
