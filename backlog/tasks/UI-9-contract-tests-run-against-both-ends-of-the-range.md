---
id: UI-9
title: "Contract tests run against both ends of the range"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done
owner: agent:loop-a
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-03
blocked_by: [UI-14]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: matrix-config
    bash: "node --test test/ci-matrix.test.mjs"
---

## Goal

Contract tests run in CI against the lowest and highest branchling releases inside SUPPORTED_RANGE.

## Context

test/adapter.test.mjs runs against whatever branchling is on PATH. Compatibility is a promise only if both ends of the declared range are exercised on every change.

## Steps

1. Add a CI workflow installing each boundary version of branchling from npm.
2. Run `node --test test/*.test.mjs` with BRANCHLING_BIN pointing at each.

## Acceptance criteria

- [x] The CI configuration names exactly the boundary versions derived from SUPPORTED_RANGE in src/adapter.mjs. [proof: matrix-config]
