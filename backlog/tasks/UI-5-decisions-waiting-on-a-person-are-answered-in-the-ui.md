---
id: UI-5
title: "Decisions waiting on a person are answered in the UI"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: [UI-1]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: decisions-view
    bash: "node --test test/decisions-view.test.mjs"
---

## Goal

The decisions view lists every task waiting on a person, with the open question, and lets the person answer through `branchling decide`.

## Context

`branchling ask` stops a task on an open question and `branchling decide` records the answer as an event. This is the screen a non-technical reader opens most; it must show who asked, when, and what the task needs.

## Steps

1. List tasks waiting on a decision with the question and its age.
2. Submit an answer through `branchling decide` via the adapter, with the actor and reason it requires.
3. Show the refusal text when branchling refuses, unchanged.

## Acceptance criteria

- [ ] A fixture task stopped with `ask` appears in the list, answering it through the view runs `decide`, and afterwards the task no longer appears. [proof: decisions-view]
