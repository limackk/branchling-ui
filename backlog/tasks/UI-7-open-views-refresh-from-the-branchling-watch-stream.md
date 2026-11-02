---
id: UI-7
title: "Open views refresh from the branchling watch stream"
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
created: 2026-11-02
updated: 2026-11-02
blocked_by: [UI-2]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: live-refresh
    bash: "node --test test/live-refresh.test.mjs"
---

## Goal

Open views refresh when the backlog changes, driven by `branchling watch --json` instead of polling.

## Context

Depends on upstream TL-524 in the branchling repository. Replaces the file-system invalidation seam left by the cache task.

## Steps

1. Run one `watch --json` child per open backlog and parse its event envelopes.
2. Push changes to the page (server-sent events) and invalidate the cache per task.
3. Restart the child on exit and show a disconnected state while it is down.

## Acceptance criteria

- [ ] Editing a fixture task while the server runs delivers one event to a connected client naming that task. [proof: live-refresh]
