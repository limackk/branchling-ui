---
id: UI-41
title: "A name-filtered test run exits when no test in a file matches"
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
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-match-exits
    bash: "for f in test/*.test.mjs; do perl -e 'alarm 60; exec @ARGV' node --test --test-name-pattern=no-test-has-this-name \"$f\" >/dev/null 2>&1 || { echo \"$f did not exit cleanly\"; exit 1; }; done"
---

## Goal

Every test file exits under a test-name filter that matches none of its tests, so a closing contract that filters by name finishes.

## Context

UI-40 moved the name filter of six closings before the file list, where node --test reads it. That exposed a second defect: under --test-name-pattern, a file in which no test matches still reaches its hooks, and node:test does not pair them. test/server.test.mjs, test/tasks-view.test.mjs and test/release-view.test.mjs started a server in `before` whose `after` never ran, so the process kept a listening socket: measured on 2026-11-04 with Node 24, the no-match run of server.test.mjs was still alive after 40 seconds and the closing of UI-24 hung for an hour. test/cache.test.mjs and test/tui.test.mjs failed the other way, with an `after` that removed a directory its `before` never created (path undefined). The three server files now build their fixture in the first test that runs, through test/fixtures/lazy-fixture.mjs; the two cleanups tolerate a fixture that was never built.

## Steps

1. Add test/fixtures/lazy-fixture.mjs and build the server fixtures of server, tasks-view and release-view through it
2. Guard the cleanups of cache and tui against a fixture that was never built
3. Run every test file under a filter that matches nothing and confirm each exits 0

## Acceptance criteria

- [x] Every test file exits 0 within 60 seconds under a name filter that matches none of its tests. [proof: no-match-exits]
