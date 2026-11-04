---
id: UI-46
title: "The vocabulary colours are checked in a real browser"
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
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: browser-check
    manual: "Open the page served for test/fixtures/vocabulary-backlog.mjs in light and dark mode and confirm each status renders in its role's pill, stats rows follow the declared order and text contrast passes WCAG AA. Evidence: a screenshot of each mode."
---

## Goal

The web page, run against test/fixtures/vocabulary-backlog.mjs, shows renamed statuses with progress, attention, success and muted pills, stats rows in the declared order, and enough contrast for each role in light and dark.

## Context

UI-18 maps a backlog's own statuses to colour roles. Its tests check the mapping as data; nobody has looked at the rendered page. The ui-verify skill describes how to run it.

## Steps

1. Start the interface against the vocabulary fixture
2. Check each pill and the row order in light and dark
3. Record the evidence

## Acceptance criteria

- [ ] Open the page served for test/fixtures/vocabulary-backlog.mjs in light and dark mode and confirm each status renders in its role's pill, stats rows follow the declared order and text contrast passes WCAG AA. Evidence: a screenshot of each mode. [proof: browser-check]
