---
id: UI-53
title: "The task filters offer the declared vocabulary"
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
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: filter-declared-values
    bash: "node --test --test-name-pattern='declared' test/tasks-view.test.mjs"
---

## Goal

The tasks view's status, priority and board filters offer the backlog's declared values from the `vocabulary` envelope, in declared order, so a person can filter by a status no task has yet without guessing its name.

## Context

Found in UI-45 on 2026-11-05. UI-18 brought branchling's `vocabulary` envelope (adapter.vocabulary(), GET /api/vocabulary), and the panel's field edits use it (UI-43), but tasksModel in src/view-model/tasks.mjs still builds the filter suggestions (`options`) only from the rows and the keys of a `stats` envelope. A declared status or board no task currently carries is never offered, and the order is first-seen, not declared. The filters stay free text with suggestions: a value is passed to `query` as typed (a comma is branchling's OR), and a rejected name is already answered with the declared names (UI-44). Pre-flight: src/view-model/tasks.mjs (WHICH TASKS, THE FILTERS and the `options` block), src/view-model/roles.mjs (currentVocabulary, statusOrder, priorityOrder), src/view-model/task-fields.mjs (declaredValues, how UI-43 reads the envelope), src/web/tasks.mjs (syncOptions) and the comment above `.tasks-controls` in src/web/styles.css, which names this task.

## Steps

1. Merge the vocabulary's declared statuses, priorities and boards into tasksModel's options, declared values first in declared order, then any value seen in the answers that the vocabulary does not declare
2. Keep the current behaviour when the vocabulary is not known (null)
3. Update the comments in src/web/tasks.mjs and src/web/styles.css that name UI-53
4. Add tests in test/tasks-view.test.mjs over a non-default vocabulary

## Acceptance criteria

- [ ] The tasks filters offer the declared statuses, priorities and boards in declared order. [proof: filter-declared-values]
