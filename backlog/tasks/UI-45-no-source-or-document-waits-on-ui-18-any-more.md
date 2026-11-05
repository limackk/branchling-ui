---
id: UI-45
title: "No source or document waits on UI-18 any more"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done
owner: agent:loop-ui-45
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-ui18-wait
    bash: "! grep -rn 'until UI-18\\|once UI-18 lands' src docs"
---

## Goal

Every remaining mention of 'until UI-18' in src/ and docs/ is either resolved or states why it still holds.

## Context

UI-18 landed, but src/view-model/plan.mjs:10, src/view-model/overview.mjs:26, src/view-model/health.mjs:22 and docs/architecture.md (near lines 128, 467 and 536) still explain the missing vocabulary as waiting on it, and docs/design/design-system.html (line 153) has a 'Likely mapping once UI-18 lands' column. Each needs a decision: keep using branchling's computed counts, or use the archived set and roles now available.

## Steps

1. Decide each mention
2. Fix it or reword it to say why it still holds
3. State the actual mapping of STATUS_ROLE_COLOURS in the design system page

## Acceptance criteria

- [x] No source or document still waits on UI-18. [proof: no-ui18-wait]
