---
id: UI-28
title: "The health view shows setup checks and the release gate"
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
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: health-view
    bash: "node --test test/health-view.test.mjs test/adapter.test.mjs"
  - id: health-screens
    manual: "The health view was checked with the ui-verify skill in light and dark at 375 px and desktop width, keyboard only."
---

## Goal

The web interface has a Health view: branchling's setup checks (`doctor`) and guards (`check`), each with its result and what to do, so a maintainer sees what is wrong with the backlog without a terminal.

## Context

Part of the 'Without a release' wave (2026-11-02): work the pinned branchling 7d76538 already supports, done while the next branchling release is prepared. Read docs/design/README.md ('Screens and their data'), the matching mockup in docs/design/mockups/, docs/architecture.md and the ui-web and ui-verify skills first. A view is one module in src/views/ plus one line in src/views/index.mjs, its view model is pure functions in src/view-model/, and reads go through the cache join in bin/branchling-ui.mjs. Tests run with `npm test` (the pinned branchling); fixtures use only commands the pin has. Mockup: docs/design/mockups/health.html. Data: `doctor --json` (kind doctor: ok, root, next, checks) and `check --json` (kind check: ok, failed, guards); add typed adapter calls with contract tests per the ui-adapter skill. Show branchling's own sentences unchanged; a failing check is data, not an error state. Divergent tasks (`stats --json` divergent) may be listed here too.

## Steps

1. Add `doctor()` and `check()` to src/adapter.mjs with contract tests over a fixture backlog, one passing and one failing
2. Add the health view model and the view route and page module
3. Add the Health link to the app shell, with a badge for failing checks
4. Test the view model and the route over a healthy and a broken fixture

## Acceptance criteria

- [ ] The adapter returns doctor and check envelopes, and the health view shows a healthy and a broken fixture backlog. [proof: health-view]
- [ ] The health view was checked with the ui-verify skill in light and dark at 375 px and desktop width, keyboard only. [proof: health-screens]
