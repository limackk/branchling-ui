---
id: UI-10
title: "The package name is decided before the first publish"
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
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: name-decided
    manual: "package.json carries the decided name and docs/architecture.md records why."
---

## Goal

The package name and publication channel are decided before the first publish.

## Context

The npm organisation `branchling` exists; branchling itself is published unscoped. Options: `@branchling/ui` (clearly an official companion, scoped) or `branchling-ui` (unscoped, mirrors the repository name). package.json currently says `branchling-ui` with `private: true` as a placeholder.

## Steps

1. Decide the name with the reasoning written in docs/architecture.md.
2. Update package.json and README.md, and add the release procedure.

## Acceptance criteria

- [ ] package.json carries the decided name and docs/architecture.md records why. [proof: name-decided]
