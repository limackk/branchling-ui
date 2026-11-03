---
id: UI-8
title: "Releases are declared and planned from the interface"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done
owner: agent:loop-c
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-03
blocked_by: [UI-4, UI-6, UI-14]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: release-manage
    bash: "node --test test/release-manage.test.mjs"
---

## Goal

Releases can be declared and tasks planned for them from the interface, through branchling's commands.

## Context

Depends on upstream TL-522 in the branchling repository, which first decides whether a command may write `releases:` and `deploy_targets` at all. If that decision is no, this task becomes a read-only guide pointing at config.yaml and is rescoped with a reason.

## Steps

1. Wrap the release vocabulary command in the adapter.
2. Add a release planning screen: declare a release, assign tasks through the field-write command, compare plan with shipped through deploy status.

## Acceptance criteria

- [x] Declaring a release on a fixture backlog makes it selectable, and planning a fixture task for it is visible in `query --release`. [proof: release-manage]
