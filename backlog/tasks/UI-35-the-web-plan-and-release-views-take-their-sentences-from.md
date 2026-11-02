---
id: UI-35
title: "The web plan and release views take their sentences from the shared view model"
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
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: web-shared-text
    bash: "npm test && node --test --test-name-pattern='PLAN_TEXT|RELEASE_TEXT' test/view-model.test.mjs"
---

## Goal

src/web/plan.mjs and src/web/release.mjs render their headings and state sentences from PLAN_TEXT and RELEASE_TEXT in src/view-model/, as the stats page does from STATS_TEXT since UI-19, so the web page and the terminal interface cannot drift on what they say.

## Context

UI-31 added PLAN_TEXT (src/view-model/plan.mjs) and RELEASE_TEXT (src/view-model/release.mjs) and the terminal screens render from them, but did not edit src/web/ because UI-26, UI-28 and UI-29 were changing the shell in parallel. The web pages still carry their own copies of the same sentences. They already differ in one place: the plan's empty-state hint says `branchling plan add <ID> --wave "<name>"` on the web and `ID`/`NAME` in PLAN_TEXT, because the view-model tests forbid `<` in model strings. Decide one placeholder style for commands shown to the user and use it on both surfaces.

## Steps

1. Read .agents/skills/ui-web/SKILL.md, src/view-model/plan.mjs (PLAN_TEXT) and src/view-model/release.mjs (RELEASE_TEXT)
2. Import them in src/web/plan.mjs and src/web/release.mjs and replace each literal they cover
3. Add a test, like UI-19's, that neither page carries a PLAN_TEXT or RELEASE_TEXT sentence as its own literal

## Acceptance criteria

- [ ] The web plan and release pages render the shared sentences and carry no copies of their own. [proof: web-shared-text]
