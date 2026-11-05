---
id: UI-43
title: "The panel's field edits offer the declared values"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done
owner: agent:loop-ui-43
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: declared-values
    bash: "node --test --test-name-pattern='declared values' test/field-edit.test.mjs"
---

## Goal

The task panel's edit control for a field with a closed vocabulary lists the values the backlog declares, read from adapter.vocabulary(), instead of a free-text input.

## Context

UI-18 brought the `vocabulary` envelope (statuses, priorities, types, confidence, estimates, labels, boards, roles, releases, deploy_targets) into the adapter. src/view-model/task-fields.mjs (near line 23) and src/web/task.mjs (near line 45) still say the values are not available as data 'until UI-18'.

## Steps

1. Feed the declared values of each field from adapter.vocabulary() into the panel's field model
2. Render them as a choice, keeping free text where the executable has no vocabulary
3. Add a contract test over test/fixtures/vocabulary-backlog.mjs

## Acceptance criteria

- [x] The panel offers the declared values of a closed-vocabulary field from the vocabulary envelope. [proof: declared-values]
