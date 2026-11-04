---
id: UI-48
title: "A person's write through the panel is never the default agent's"
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
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: panel-actor
    bash: "node --test --test-name-pattern='actor' test/task-actions.test.mjs test/field-edit.test.mjs"
---

## Goal

take, release, handoff and set issued from the task panel on behalf of a person pass --require-actor and read actorSource, so a person's act is refused or shown, never recorded silently as the default agent.

## Context

TL-537 and TL-544 gave branchling's writing commands actorSource and --require-actor. UI-23 uses them for decide only; src/adapter.mjs still runs take, release, handoff and set from the panel without them (actorNote in src/view-model/task-actions.mjs explains the gap).

## Steps

1. Pass --require-actor from the panel's writing calls
2. Surface actorSource and the refusal in the panel
3. Test each command's refusal without an actor

## Acceptance criteria

- [ ] A panel write without a stated actor is refused or shown, and one with an actor is recorded under it. [proof: panel-actor]
