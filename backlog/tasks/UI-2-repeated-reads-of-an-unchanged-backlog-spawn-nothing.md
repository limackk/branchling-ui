---
id: UI-2
title: "Repeated reads of an unchanged backlog spawn nothing"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: done
owner: agent:loop-c
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: cache
    bash: "node --test test/cache.test.mjs"
---

## Goal

Repeated reads of an unchanged backlog do not spawn a branchling process per call.

## Context

Measured on 2026-11-02 by test/adapter.test.mjs: one `query --json` costs about 500 ms of process start and tree scan. A view that refreshes several panels would spend seconds per refresh. Until upstream TL-524 ships `branchling watch --json`, invalidation has to come from the file system (tasks/, history/, plan.yaml, config.yaml) and from `git rev-parse HEAD`, because cross-branch state changes with commits elsewhere. The cache must never answer with data older than the last observed change: a stale answer reads exactly like a fresh one.

## Steps

1. Add a cache in front of the adapter's reading calls, keyed by command and arguments.
2. Invalidate on any change under the backlog directory and on a change of HEAD, and expose the time of the answer to callers.
3. Leave a seam for replacing file watching with `branchling watch --json` once TL-524 is released.

## Acceptance criteria

- [x] Two identical reads spawn branchling once, and editing a fixture task between them makes the second read spawn again and return the edit. [proof: cache]
