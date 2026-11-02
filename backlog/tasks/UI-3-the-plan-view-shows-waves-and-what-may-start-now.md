---
id: UI-3
title: "The plan view shows waves and what may start now"
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
  - id: plan-view
    bash: "node --test test/plan-view.test.mjs"
  - id: verify-skill
    bash: "test -f .agents/skills/ui-verify/SKILL.md && test -L .claude/skills/ui-verify"
---

## Goal

The execution plan view shows waves, what may start now, what is in flight and what is unplanned, from `branchling plan --json`.

## Context

branchling's own viewer has an Execution tab whose shortcomings are described in docs/viewer-redesign-brief.md section 7 of the branchling repository. This view is the first real screen of this package and should answer the questions that brief lists, not copy the existing tab.

## Steps

1. Render the `plan` envelope: waves in order, the active wave highlighted, blocked_by edges.
2. Show unplanned tasks and tasks the plan has been overtaken by.
3. Link each task to a detail panel fed by `show`.
4. Write `.agents/skills/ui-verify/SKILL.md` (symlinked from `.claude/skills`): the definition of done for any view, proven on this first one. Run it on a fixture backlog; screenshot it in light and dark at 375px and desktop width; check the terminal interface (UI-16), when it exists, at 80 columns, under NO_COLOR and with output redirected; run an automated accessibility audit.

## Acceptance criteria

- [ ] For a fixture backlog with a two-wave plan, the rendered model lists both waves in order, marks the active one, and lists an unplanned fixture task. [proof: plan-view]
- [ ] The definition of done for a view is a skill. [proof: verify-skill]
