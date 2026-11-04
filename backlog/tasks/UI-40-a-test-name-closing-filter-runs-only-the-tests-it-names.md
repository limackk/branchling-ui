---
id: UI-40
title: "A test-name closing filter runs only the tests it names"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done
owner: agent:coordinator
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: filter-first
    bash: "! grep -lE 'bash: \"npm test -- ' backlog/tasks/*.md && grep -lE \"bash: \\\"node --test --test-name-pattern=\" backlog/tasks/UI-22-*.md backlog/tasks/UI-23-*.md backlog/tasks/UI-24-*.md backlog/tasks/UI-33-*.md backlog/tasks/UI-34-*.md backlog/tasks/UI-39-*.md | wc -l | grep -qx ' *6'"
---

## Goal

A closing contract that names tests by pattern runs only those tests: the filter is placed before the file list, where node --test reads it.

## Context

Six open tasks (UI-22, UI-23, UI-24, UI-33, UI-34, UI-39) close with `npm test -- --test-name-pattern='<p>'`. npm appends the arguments after the script, so the command becomes `node --test test/*.test.mjs --test-name-pattern=<p>`, and node --test ignores an option that follows the file arguments: measured on 2026-11-04 with Node 24, `node --test test/release-view.test.mjs --test-name-pattern=undeclared` ran all 17 tests, while `node --test --test-name-pattern=undeclared test/release-view.test.mjs` ran the 4 matching ones. Each of those closings was therefore the whole suite in disguise: it could not close a task while any unrelated test failed, and it ran the full suite where a loop was told to run only its own tests. The fix is the order of the arguments, not the pattern: every line keeps its pattern and its claim.

## Steps

1. Rewrite the six verification lines to `node --test --test-name-pattern='<pattern>' test/*.test.mjs`, keeping every pattern and the rest of each line unchanged
2. Record the edits in history with a reason

## Acceptance criteria

- [x] No open task closes through an npm test line whose name filter is ignored, and the six affected tasks filter before the file list. [proof: filter-first]
