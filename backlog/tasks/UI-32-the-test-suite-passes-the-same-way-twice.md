---
id: UI-32
title: "The test suite passes the same way twice"
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
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: stable-suite
    bash: "for i in 1 2 3 4 5 6 7 8 9 10; do npm test >/dev/null 2>&1 || exit 1; done"
---

## Goal

`npm test` gives the same answer on every run, so a red run means a real failure and nobody learns to rerun until green.

## Context

Found during UI-25 on 2026-11-02: one run of `npm test` in about fifteen failed and passed on rerun; the failing test was never identified. The run competed with fixture servers and a browser, so timing is the suspect: the cache tests use racy windows and file timestamps, the server tests bind ports, the TUI tests drive a pseudo terminal. Run with the pinned branchling (`npm test`).

## Steps

1. Run the suite repeatedly under load (several in parallel) until the failing test is caught, recording which one and its output
2. Find the cause and fix it in the test or the code, not by raising a timeout without a reason
3. Record the cause in the commit body

## Acceptance criteria

- [ ] The whole suite passes ten consecutive runs. [proof: stable-suite]
