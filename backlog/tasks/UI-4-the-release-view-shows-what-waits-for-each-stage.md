---
id: UI-4
title: "The release view shows what waits for each stage"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: pending
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: [UI-1, UI-2]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: release-view
    bash: "node --test test/release-view.test.mjs"
---

## Goal

The release pipeline view shows, per deploy target, what waits for each stage and how long, from `branchling deploy status --json`.

## Context

branchling computes promotion buckets from git (closed but not on trunk, on trunk but not in the first stage, then stage by stage). The envelope kind is `release-status`. A backlog with no `deploy_targets` must render an explanatory empty state, not an error.

## Steps

1. Render one lane per target and one column per stage with task counts and waiting time.
2. Support `--release <name>` to compare a planned release with what shipped.
3. Show the refs and SHAs the answer was computed from, as the CLI does.

## Acceptance criteria

- [ ] For a fixture repository with one target and two stages, the rendered model places a closed task in the correct bucket, and a fixture with no targets renders the empty state. [proof: release-view]
