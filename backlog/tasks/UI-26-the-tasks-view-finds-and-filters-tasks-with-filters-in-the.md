---
id: UI-26
title: "The tasks view finds and filters tasks with filters in the URL"
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
  - id: tasks-view
    bash: "node --test test/tasks-view.test.mjs"
  - id: tasks-screens
    manual: "The tasks view was checked with the ui-verify skill in light and dark at 375 px and desktop width, in every state, keyboard only."
---

## Goal

The web interface has a Tasks view: every task of the backlog in a list that can be searched and filtered by status, priority, board, epic, owner and label, with the filters in the URL so a filtered list can be reloaded, shared and reached with Back.

## Context

Part of the 'Without a release' wave (2026-11-02): work the pinned branchling 7d76538 already supports, done while the next branchling release is prepared. Read docs/design/README.md ('Screens and their data'), the matching mockup in docs/design/mockups/, docs/architecture.md and the ui-web and ui-verify skills first. A view is one module in src/views/ plus one line in src/views/index.mjs, its view model is pure functions in src/view-model/, and reads go through the cache join in bin/branchling-ui.mjs. Tests run with `npm test` (the pinned branchling); fixtures use only commands the pin has. Mockup: docs/design/mockups/tasks.html. Data: `query --json` with its filters (the adapter's `query(filters)` already maps them); `query` returns active tasks only unless asked otherwise, so say which set the list shows. The filter values offered come from the answers themselves (or stay free text) until UI-18 brings the vocabulary; nothing hard-codes status names. Each row links to the task panel's URL (`?view=tasks&task=<ID>`), which the next task in this wave builds; until then the link may open the row's id only. Below 640 px the table folds into a list (the mockup's rule).

## Steps

1. Add the tasks view model (src/view-model/tasks.mjs) from a task-list envelope, with the filters parsed from and written to URL search params
2. Add the view route and the page module, with search (the mockup's / key) and every view state
3. Add the Tasks link to the app shell navigation
4. Test the view model, the route over a fixture backlog with several statuses and priorities, and the URL round trip of every filter

## Acceptance criteria

- [ ] A fixture backlog is listed, filtered by each filter, and the filters survive a URL round trip. [proof: tasks-view]
- [ ] The tasks view was checked with the ui-verify skill in light and dark at 375 px and desktop width, in every state, keyboard only. [proof: tasks-screens]
