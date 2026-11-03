---
id: UI-6
title: "Task fields are edited through the field command"
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
updated: 2026-11-03
blocked_by: [UI-14]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: field-edit
    bash: "node --test test/field-edit.test.mjs"
---

## Goal

A task's fields can be edited in the interface, each edit carried out by branchling's field-write command with actor and reason.

## Context

Depends on upstream TL-521 in the branchling repository (a callable field-write command). Until it is released there is no supported way to edit fields from outside branchling, and this package must not write task files itself. Fields with dedicated commands (status through take, done, handoff, release, ask) keep those commands.

## Steps

1. Wrap the new command in the adapter with a typed method.
2. Offer inline editing for the fields the command accepts, collecting a reason where branchling requires one.
3. Raise SUPPORTED_RANGE.min to the first branchling release that ships the command.

## Acceptance criteria

- [ ] Editing a fixture task's priority through the adapter changes the file and appends a history record with the given actor, and a status edit is refused. [proof: field-edit]
