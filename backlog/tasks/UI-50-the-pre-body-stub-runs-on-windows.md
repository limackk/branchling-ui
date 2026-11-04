---
id: UI-50
title: "The pre-body stub runs on Windows"
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
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: windows-stub
    manual: "CI's windows-latest job passes test/task-panel.test.mjs, including the pre-body stub. Evidence: the job URL."
---

## Goal

The Windows .cmd variant of preBodyBin in test/task-panel.test.mjs passes in CI's windows-latest job.

## Context

UI-37 added a stub executable without `show --body`, with a .cmd variant for Windows that has never run. It only runs in CI.

## Steps

1. Push a branch and read the windows-latest job
2. Fix the .cmd variant if it fails

## Acceptance criteria

- [ ] CI's windows-latest job passes test/task-panel.test.mjs, including the pre-body stub. Evidence: the job URL. [proof: windows-stub]
