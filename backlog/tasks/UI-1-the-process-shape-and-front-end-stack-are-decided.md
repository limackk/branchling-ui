---
id: UI-1
title: "The process shape and front-end stack are decided"
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
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [UI-16]                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: server-smoke
    bash: "node --test test/server.test.mjs"
  - id: web-skill
    bash: "test -f .agents/skills/ui-web/SKILL.md && test -L .claude/skills/ui-web && grep -qi 'view model' docs/architecture.md"
---

## Goal

The process shape and the front-end stack are decided and written in docs/architecture.md, so every view task builds on one choice.

## Context

The adapter (src/adapter.mjs) exists; nothing renders yet. Open questions: a local HTTP server bound to 127.0.0.1 serving a single-page app (the model `branchling serve` uses) versus a desktop shell; a framework versus no framework; whether a build step is acceptable. Constraints: the adapter stays the only door into branchling; the server must never write task files itself; it must work on a backlog in any repository, not only this one.

## Steps

1. Compare at least two options against the constraints, including startup cost and the zero-dependency precedent branchling's own viewer sets.
2. Write the decision, the options rejected and why, into docs/architecture.md.
3. Add the minimal server skeleton the decision implies, serving one page that shows `stats` through the adapter.
4. Define the view model both surfaces render: plain data computed from adapter envelopes, with no HTML or ANSI in it, so the web interface and the terminal interface (UI-16) cannot drift.
5. Write `.agents/skills/ui-web/SKILL.md` (symlinked from `.claude/skills`) for the decided conventions: design tokens for light and dark, status and priority colours derived from config.yaml, the loading, empty, error, refusal and stale states every view has, view state in the URL, WCAG 2.2 AA and keyboard use.

## Acceptance criteria

- [ ] The server starts on 127.0.0.1, serves the page, and its stats endpoint returns the adapter's stats envelope for a fixture backlog. [proof: server-smoke]
- [ ] The web conventions are a skill and the shared view model is recorded in docs/architecture.md. [proof: web-skill]
