---
id: UI-14
title: "The supported range names a release with show and deploy"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P0
status: done
owner: agent:loop-c
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: pinned-suite
    bash: "npm ci && npm test"
  - id: registry-pin
    bash: "node -e \"const v = require('./package.json').devDependencies.branchling; if (!/^[~^]?\\d/.test(v)) { console.error('pinned to ' + v); process.exit(1) }\""
---

## Goal

SUPPORTED_RANGE names only branchling releases that actually have every command the adapter calls, and the pinned devDependency is one of them.

## Context

Found while doing UI-11. With branchling pinned from npm, `npm test` fails: the published 0.2.0 has no `show` and no `deploy` command, which the adapter wraps (`show`, `deployStatus`). The suite had passed only because the global `branchling` was a linked checkout of the upstream repository 41 commits past v0.2.0 that still reports `0.2.0`. So SUPPORTED_RANGE `[0.2.0, 0.3.0)` promises a release that cannot serve this package. Moving the range is a deliberate change with tests (AGENTS.md). The likely fix is an upstream release carrying `show` and `deploy`, then raising `min` to it and the pin with it; until then the devDependency can point at an upstream commit instead of a registry release. The maintainer chose the commit pin first: UI-11 pins upstream 7d76538. That makes the tests reproducible but leaves this task open, because the range still promises a registry release that has neither command. What remains is a published release with both, the range minimum raised to it, and the pin moved from the commit to that release.

## Steps

1. Ask upstream for a release that carries show and deploy, or pin the devDependency to an upstream commit
2. Raise SUPPORTED_RANGE.min to the first release that has both, together with the devDependency
3. Make the version test fail for a release below that minimum

## Acceptance criteria

- [x] The contract tests pass against the executable package-lock.json pins, not against whatever is on PATH. [proof: pinned-suite]
- [x] The devDependency is a registry release, not a commit. [proof: registry-pin]
