---
id: UI-47
title: "The overview's wave card shows a refused plan's own heading"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done
owner: agent:loop-ui-47
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
  - id: wave-refusal
    bash: "node --test --test-name-pattern='refused plan' test/overview.test.mjs"
---

## Goal

A contradicting or unparsable plan shows its PLAN_REFUSAL_TEXT heading and problems on the overview's active-wave card, not the generic 'branchling declined the request'.

## Context

UI-22 gave the plan view a refusal state per refusalKind. The overview's active-wave card (wavePart in src/view-model/overview.mjs and src/web/overview.mjs) still renders the same refusal generically.

## Steps

1. Map the plan's refusalKind to PLAN_REFUSAL_TEXT in wavePart
2. Show the problems
3. Test both kinds in test/overview.test.mjs

## Acceptance criteria

- [x] The overview shows a refused plan's own heading and problems. [proof: wave-refusal]
