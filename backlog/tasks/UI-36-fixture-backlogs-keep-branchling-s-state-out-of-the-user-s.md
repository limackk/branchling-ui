---
id: UI-36
title: "Fixture backlogs keep branchling's state out of the user's home"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-03
blocked_by: [UI-32]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: fixture-state
    bash: "node --test test/fixture-homes.test.mjs && grep -q XDG_STATE_HOME test/fixtures/env.mjs"
---

## Goal

Every fixture builder in test/fixtures/ runs branchling with XDG_STATE_HOME (as well as XDG_DATA_HOME and XDG_CONFIG_HOME) inside the fixture's own root, so building a fixture never writes locks or runs into the user's real state directory and two builds can never collide on a lock.

## Context

Found during UI-29 on 2026-11-02. test/fixtures/plan-backlog.mjs fixtureEnv sets XDG_DATA_HOME and XDG_CONFIG_HOME but not XDG_STATE_HOME, while health-backlog.mjs sets all three. plan-backlog runs `take TASK-2`, whose lock lands in ~/.local/state/branchling/locks; building overview-backlog.mjs (which composes plan-backlog) into a fresh scratch directory failed with 'TASK-2 is held by agent:fixture … lock expires after 120 minutes'. Every test that builds the plan fixture writes there too, so this may also be one cause of the intermittent failure UI-32 is after. The fix is one line plus a test; a shared fixtureEnv for all builders would stop the drift between them.

## Steps

1. Add XDG_STATE_HOME to fixtureEnv in test/fixtures/plan-backlog.mjs, or export one fixtureEnv that every builder in test/fixtures/ imports
2. Add a test that builds the plan fixture twice into two fresh directories with a temporary HOME and asserts nothing is written under that HOME
3. Run npm test several times and note in UI-32 whether the intermittent failure was seen

## Acceptance criteria

- [x] fixture builds keep branchling's state inside the fixture [proof: fixture-state]
