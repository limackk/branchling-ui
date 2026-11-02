---
id: UI-31
title: "The terminal interface shows the plan, releases and decisions"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: pending
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: tui-screens
    bash: "node --test test/tui.test.mjs"
---

## Goal

The terminal interface has screens for the plan, the release pipeline and the open questions, rendered from the same view models as the web pages, with keys to move between them.

## Context

Part of the 'Without a release' wave (2026-11-02): work the pinned branchling 7d76538 already supports, done while the next branchling release is prepared. Read docs/design/README.md ('Screens and their data'), the matching mockup in docs/design/mockups/, docs/architecture.md and the ui-web and ui-verify skills first. A view is one module in src/views/ plus one line in src/views/index.mjs, its view model is pure functions in src/view-model/, and reads go through the cache join in bin/branchling-ui.mjs. Tests run with `npm test` (the pinned branchling); fixtures use only commands the pin has. Today the TUI (UI-16, UI-20) has one stats screen. src/view-model/plan.mjs, release.mjs and decisions.mjs already exist; the TUI renders them as lines of text under the rules of the ui-terminal skill (80 columns, NO_COLOR, TERM=dumb, the 16 ANSI colours, the terminal restored on every exit). Answering a question from the terminal is out of scope: show the question and how to answer it with `branchling decide`.

## Steps

1. Add a screen per view model in src/tui/, rendering the existing view model without new data logic
2. Add keys to switch screens, shown in the key map
3. Test each screen at 80 columns, under NO_COLOR, and that switching keeps the terminal restorable

## Acceptance criteria

- [ ] The plan, release and decisions screens render at 80 columns from their view models, with no ANSI codes under NO_COLOR, and the terminal is restored after an exception on each. [proof: tui-screens]
