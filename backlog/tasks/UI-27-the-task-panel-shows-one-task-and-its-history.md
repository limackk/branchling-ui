---
id: UI-27
title: "The task panel shows one task and its history"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: done
owner: agent:loop-a
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: [UI-26]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: task-panel
    bash: "node --test test/task-panel.test.mjs"
  - id: panel-screens
    manual: "The task panel was checked with the ui-verify skill in light and dark at 375 px and desktop width, keyboard only, including focus return on close."
---

## Goal

Any task can be opened in a panel showing everything branchling reports about it, its fields, blockers and history, from the tasks list, the plan and the decisions view, with its id in the URL so Back closes it.

## Context

Part of the 'Without a release' wave (2026-11-02): work the pinned branchling 7d76538 already supports, done while the next branchling release is prepared. Read docs/design/README.md ('Screens and their data'), the matching mockup in docs/design/mockups/, docs/architecture.md and the ui-web and ui-verify skills first. A view is one module in src/views/ plus one line in src/views/index.mjs, its view model is pure functions in src/view-model/, and reads go through the cache join in bin/branchling-ui.mjs. Tests run with `npm test` (the pinned branchling); fixtures use only commands the pin has. Mockup: docs/design/mockups/task.html. Data: `show <ID> --json` (task-show) and `log <ID> --json` (task-log). The panel opens over the view it came from; `?task=<ID>` on any view opens it, and Back closes it. `show --json` deliberately never carries the body (its own help says so, at the pin and upstream), so the panel shows a short line where the body would be, saying the description is in the task file and the interface cannot read it yet; showing the body is UI-37. This task is read-only; the write actions are a later task of this wave. An unknown id is the not-found state, not an error.

## Steps

1. Add the task view model from task-show and task-log envelopes (fields, blockers both ways, history entries in order)
2. Add the panel route and page module, opened by `?task=<ID>` over any view, with focus moved into it and returned on close, Escape closing it
3. Link task ids in the tasks, plan and decisions views to the panel
4. Test the view model, the route over a fixture task with history, the not-found state, and that task text containing HTML is shown as text

## Acceptance criteria

- [x] A fixture task's fields, blockers and history are shown, an unknown id is the not-found state, and task text containing HTML is shown as text. [proof: task-panel]
- [x] The task panel was checked with the ui-verify skill in light and dark at 375 px and desktop width, keyboard only, including focus return on close. [proof: panel-screens]
