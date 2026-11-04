---
id: UI-49
title: "The task panel reaches any task without naming a status"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: panel-scope-all
    bash: "node --test test/task-panel.test.mjs && ! grep -n 'status } : { text: id }' src/adapter.mjs"
---

## Goal

readTask finds a task's row through query --scope all instead of passing the status from show, and the panel still opens an archived task.

## Context

src/adapter.mjs readTask reads the row with `query --text <id>` plus the status taken from show, because branchling 0.3 could not search every status at once. UI-33 brought query --scope; TASKS_TEXT.selectionMissing in src/view-model/tasks.mjs still says a task 'may be archived or outside the filters'.

## Steps

1. Read the row with --scope all
2. Reword selectionMissing
3. Keep the archived-task test in test/task-panel.test.mjs green

## Acceptance criteria

- [ ] The panel no longer passes a status from show and still opens an archived task. [proof: panel-scope-all]
