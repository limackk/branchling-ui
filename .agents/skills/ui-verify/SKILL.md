---
name: ui-verify
description: The definition of done for any view of branchling-ui, and how to prove it. Covers the tests, running a view on a fixture backlog, screenshots in light and dark at phone and desktop width, provoking every state (loading, empty, error, refusal, stale), a keyboard-only pass at 200% zoom, the terminal interface at 80 columns, under NO_COLOR and redirected, an automated accessibility audit and the contrast of every token pair. Use this skill whenever a view is added or changed, before calling a view task finished, and for requests like "is it done", "verify the view", "check the plan screen", "does it work in dark mode", "run the accessibility audit" — even if the word verify never comes up.
---

# When a view is done

A view is done when every item below holds, checked on a fixture backlog, never
on this repository's own `backlog/`. Building it is the `ui-web` skill; this is
the proof. Proven first on the plan view (UI-3); the commands use it as the
example, so swap `plan` for the view you are checking.

## 1. The tests are green

```bash
npm test    # with node_modules/.bin first on PATH, as CI runs it
```

That runs the PINNED branchling from `package-lock.json`. A green run
against a newer global `branchling` proves nothing: it has commands the pin
lacks, so a fixture may use one that CI does not have.

The view has its own `test/<view>-view.test.mjs` against the real executable:
the acceptance criterion, a positive control for every negative assertion,
the empty state, and no model string containing `<` markup or `\x1b`.

## 2. Run it on a fixture backlog

```bash
dir=$(node test/fixtures/plan-backlog.mjs)        # two waves, in flight, unplanned, overtaken
node bin/branchling-ui.mjs --dir "$dir" --port 0   # prints the address
```

Open `<address>?view=plan`, then `?view=plan&task=TASK-3` (the detail panel).
A reload and a pasted link must show the same screen. `--no-plan` builds a
backlog without a plan (the empty state). A view without a fixture builder
gets one in `test/fixtures/`, runnable the same way.

## 3. Screenshots: light and dark, 375 px and desktop width

Four per screen state that matters (at least ready, empty, detail panel open):
light 375, light 1280, dark 375, dark 1280. Use the session's browser
automation (viewport resize plus `prefers-color-scheme` emulation). Save them
OUTSIDE the repository, e.g. `$TMPDIR/branchling-ui-verify/<view>/`; they are
evidence for the review, never committed. Look at each: nothing overflows
sideways at 375 px, nothing is clipped, the active part of the screen is in the
first viewport.

## 4. Every state is reachable, and looks like itself

| State | How to provoke it |
|---|---|
| loading | `--bin` a shim that runs `sleep 3` and then `exec branchling "$@"` |
| empty | the `--no-plan` fixture |
| error | `--dir` a directory with no backlog (usage error); `--bin` a script that prints `{"schemaVersion":99,"kind":"plan"}` (contract mismatch); stop the server, then press Try again (unreachable) |
| refusal | `?view=plan&task=TASK-99` (the detail panel: `no-such-task`) |
| bad request | `/api/task?id=--help` answers 400 and spawns nothing |
| stale | nothing serves a remembered answer yet (UI-2's cache hit is fresh, not stale); the model test covers `freshness.stale` until something does |

A refusal never looks like an empty list; an error has a Try again button.

## 5. Keyboard, focus and zoom

With the keyboard alone: the skip link comes first, every link and button is
reached in reading order, a task link opens the panel and moves focus to its
heading, Escape or Close returns focus to the link, Back undoes it. The focus
ring is visible on every stop and never hidden under sticky content. Repeat at
200% browser zoom: nothing overlaps or needs sideways scrolling.

## 6. The terminal interface (UI-16), once it exists

Run the same view on the same fixture and check it three ways: at 80 columns
(`COLUMNS=80`, no line wraps mid-word, nothing truncated without saying so),
under `NO_COLOR=1` (no colour codes, and no information was carried by colour
alone), and redirected (`… | cat`, `… > out.txt`: no escape code at all, which
`grep -c $'\x1b' out.txt` must count as 0).

## 7. An automated accessibility audit

On demand, never as a dependency of the package:

```bash
npx --yes @axe-core/cli@4.10.1 "<address>?view=plan" --exit
```

Run it for each state from section 4 that renders differently. If the CLI
cannot drive a browser here, inject axe through the session's browser
automation instead (the page's CSP forbids loading it from a CDN): evaluate the
contents of `axe.min.js` from `npm pack axe-core@4.10.2` in the page, then
`await axe.run()`. Zero violations, or each one explained in the task.

## 8. Contrast of every token pair, in both schemes

```bash
node .agents/skills/ui-verify/contrast.mjs
```

It reads the tokens from `src/web/styles.css` and fails under 4.5:1 for text
and 3:1 for borders and the focus ring. A view that adds a token adds its
pairs to that script in the same change.

## Reporting

In the task's close-out, say which of these ran, where the screenshots are,
and what could not be checked and why. A step skipped silently reads exactly
like a step that passed.
