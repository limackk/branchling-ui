---
id: UI-51
title: "Typed input is judged by branchling's own refusal"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: blocked
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-guessing-helper
    bash: "! grep -q 'export function rejectingTypedInput' src/request-error.mjs && node --test --test-name-pattern='rejected' test/tasks-view.test.mjs test/task-actions.test.mjs"
---

## Goal

src/request-error.mjs no longer exports rejectingTypedInput, and the tasks view and the handoff action read branchling's unknown-value envelope for a value outside the vocabulary.

## Context

rejectingTypedInput exists only because branchling answers an undeclared query filter or handoff role with a usage message on stderr. Upstream TL-559 asks for an unknown-value envelope there; once it is released and pinned, the helper and its guesses can go.

## Steps

1. Wait for a pinned branchling carrying TL-559
2. Switch src/views/tasks.mjs and src/views/task.mjs to the envelope
3. Delete the helper and feed its tests from the real envelope

## Acceptance criteria

- [ ] The helper is gone and rejected input is fed by branchling's own envelope. [proof: no-guessing-helper]
