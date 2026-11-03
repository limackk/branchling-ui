---
id: UI-34
title: "The release gate of a missing backlog reads as a verdict"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: blocked
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: check-no-backlog
    bash: "npm test -- --test-name-pattern='not a backlog'"
---

## Goal

When --dir is not a backlog, the health view's release gate section says so as a verdict, the way the setup checks section already does, instead of the interface-bug usage error.

## Context

Found while building UI-28 on the pinned branchling 0.2.0. `doctor --json` over a directory that is not a backlog exits 1 with a normal envelope (`root: null`, one `backlog` error check), which the health view shows as data. `check --json` over the same directory crashes with a stack trace on stderr, no stdout and exit 1, so the adapter throws BranchlingUsageError and the server answers 500 usage-error. The upstream contract to ask for: a `check` envelope in that case, either `{ ok: false, root: null, failed: ["backlog"], guards: [...] }` as doctor does, or one with a refusalKind such as `no-backlog`. Rejected: detecting the crash from stderr text in this package, which AGENTS.md forbids.

Re-checked on branchling 0.3.0 (2026-11-03): the stack trace is gone, but `check --json` still prints nothing on stdout and exits 1, with the human 'no backlog here' message on stderr, so the adapter still throws BranchlingUsageError. Upstream: TL-541 in the branchling repository (filed 2026-11-03).

## Steps

1. Re-check on the pinned branchling; if fixed, skip to the last step.
2. File the contract above as an issue in limackk/branchling and record its id here.
3. Once released and pinned: map the new envelope through acceptVerdict (or the refusal state) and add a test over a directory that is not a backlog.

## Acceptance criteria

- [ ] check over a directory that is not a backlog reaches the health view as a verdict or a refusal, not a usage error. [proof: check-no-backlog]
