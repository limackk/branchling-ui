---
id: UI-33
title: "The tasks view can list every status, archived ones included"
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
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: tasks-scope
    bash: "npm test -- --test-name-pattern='scope'"
---

## Goal

The tasks view offers an Open / Archived / All scope, as the mockup docs/design/mockups/tasks.html shows, without this package naming a single status. Today it can list only the active set (query without --status) or the statuses a person types.

## Context

Found while building UI-26 against the pinned branchling 0.2.0. `query --json` without `--status` returns the active tasks only; `--status ""` gives the same set, and `all` or `*` are refused as unknown statuses. The only way to reach archived tasks is to name their status. Option (a): file upstream a `query` scope flag (for example `--scope active|archived|all`) whose envelope says which scope it answered, and map the mockup's segmented control onto it once released and pinned. Option (b): build `--status` from the keys of `stats --json` byStatus; rejected, it names statuses in the UI (the vocabulary belongs to UI-18) and would miss a task whose status is outside the config. Option (a) is the solid choice.

Upstream: TL-540 in the branchling repository (filed 2026-11-03), `query --scope active|archived|all` with a `scope` key in the envelope.

## Steps

1. Re-check against the pinned branchling whether query gained a scope or all-status flag
2. If not, file it in limackk/branchling as a CLI contract (flag, envelope key naming the scope) and record the issue id here
3. Once released and pinned: add the scope to TASK_FILTER_KEYS, the URL round trip and the page's segmented control
4. Extend test/tasks-view.test.mjs: the archived fixture task appears under All and Archived, not under Open

## Acceptance criteria

- [ ] the tasks view lists archived and all tasks through a query scope [proof: tasks-scope]
