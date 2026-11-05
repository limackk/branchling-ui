---
id: UI-46
title: "The vocabulary colours are checked in a real browser"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: browser-check
    manual: "Open the page served for test/fixtures/vocabulary-backlog.mjs in light and dark mode and confirm each status renders in its role's pill, stats rows follow the declared order and text contrast passes WCAG AA. Evidence: a screenshot of each mode."
---

## Goal

The web page, run against test/fixtures/vocabulary-backlog.mjs, shows renamed statuses with progress, attention, success and muted pills, stats rows in the declared order, and enough contrast for each role in light and dark.

## Context

UI-18 maps a backlog's own statuses to colour roles. Its tests check the mapping as data; nobody has looked at the rendered page. The ui-verify skill describes how to run it.

## Steps

1. Start the interface against the vocabulary fixture
2. Check each pill and the row order in light and dark
3. Record the evidence

## Acceptance criteria

- [x] Open the page served for test/fixtures/vocabulary-backlog.mjs in light and dark mode and confirm each status renders in its role's pill, stats rows follow the declared order and text contrast passes WCAG AA. Evidence: a screenshot of each mode. [proof: browser-check]

## Evidence

Checked on 2026-11-05 against branchling's unreleased main (BRANCHLING_BIN), on test/fixtures/vocabulary-backlog.mjs with one task created in each declared status through `branchling new --status` (the fixture itself holds no task), served by `bin/branchling-ui.mjs` and opened in the desktop app's browser with `prefers-color-scheme` emulated.

- Pills: todo is the neutral pill (role open), doing is progress (active), parked and review are attention (waiting, review through `status_roles`), shipped is success (closed), dropped is muted (cancelled). The same in the task list, the overview's in-flight card and its By status rows.
- Order: the overview's By status rows read todo, doing, parked, review, shipped, dropped, and Open by priority reads urgent, high, normal, someday, both the declared order.
- Contrast of each status pill's text on its pill, measured in the page: light 6.29 to 11.27:1, dark 5.69 to 10.15:1, all above WCAG AA's 4.5:1. `node .agents/skills/ui-verify/contrast.mjs`: 92 pairs, 0 failing.
- Screenshots, kept outside the repository: dark-tasks.jpg, dark-overview-stats.jpg, light-tasks.jpg, light-overview-stats.jpg.
- Not checked here: the 375 px width, keyboard and zoom, and the axe audit. This task asks for colour, order and contrast only.
