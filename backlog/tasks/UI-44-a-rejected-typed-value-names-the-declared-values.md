---
id: UI-44
title: "A rejected typed value names the declared values"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done
owner: agent:loop-ui-44
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: declared-lists
    bash: "node --test --test-name-pattern='declared' test/tasks-view.test.mjs test/task-actions.test.mjs"
---

## Goal

A 422 rejected-input answer names the declared statuses, priorities, boards, roles and releases when the executable answers `vocabulary`, and stays null when it does not.

## Context

src/views/tasks.mjs, src/views/task.mjs (handoff role) and src/views/release.mjs (declaredNames, release) pass `null` declared lists to rejectingTypedInput, and the tasks view's filters (src/view-model/tasks.mjs, near line 22) say the vocabulary is unknown. Since UI-18 the vocabulary envelope gives these lists. TL-559 upstream may later replace the helper with branchling's own envelope.

## Steps

1. Pass the declared lists from adapter.vocabulary() to each rejectingTypedInput call
2. Keep null when the executable has no vocabulary
3. Test both cases

## Acceptance criteria

- [x] A rejected typed value names the declared values when vocabulary is available, and null otherwise. [proof: declared-lists]
