---
id: UI-19
title: "The web stats view takes its sentences from the shared view model"
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
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: web-stats-text
    bash: "node --test test/*.test.mjs && ! grep -q 'This backlog has no tasks yet' src/web/app.mjs"
---

## Goal

src/web/app.mjs renders the stats headings and state sentences from STATS_TEXT in src/view-model/stats.mjs instead of its own string literals, so the web page and the terminal interface cannot drift on what they say.

## Context

UI-16 added STATS_TEXT to src/view-model/stats.mjs and the TUI renders from it. The web page (src/web/app.mjs, UI-1) still hard-codes the same sentences ("Loading stats…", "This backlog has no tasks yet.", the stale notice, "By status", "By priority"). UI-16 did not edit src/web/ because parallel view tasks were changing it. Today the strings are identical; the risk is the next edit to one surface only.

## Steps

1. Read .agents/skills/ui-web/SKILL.md and src/view-model/stats.mjs
2. Import STATS_TEXT in src/web/app.mjs and replace each literal it covers
3. Add a test that src/web/app.mjs contains none of the STATS_TEXT sentences as literals

## Acceptance criteria

- [x] the web page no longer carries its own copy of the stats sentences [proof: web-stats-text]
