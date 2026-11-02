---
id: UI-17
title: "The adapter starts branchling on Windows"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: in_progress
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: suite
    bash: "npm test"
  - id: windows-ci
    manual: "The windows-latest job of the test workflow is green on the commit that closes this task."
---

## Goal

The adapter starts branchling on Windows the way it does on Linux and macOS, so a Windows user with branchling installed through npm gets envelopes instead of ENOENT, and the Windows CI job is green.

## Context

The first CI run (run 41457636443, 2026-11-02) passed on all six Linux and macOS jobs and failed every test on windows-latest with `spawnSync branchling ENOENT`. On Windows npm installs a bin as a `branchling.cmd` shim; `execFile` and `execFileSync` without a shell do not resolve PATHEXT and cannot start a `.cmd` file. src/adapter.mjs spawns the same way, so this is a product defect, not only a test one. The obvious fix, `shell: true`, routes arguments through cmd.exe, whose quoting rules differ from every other platform; the adapter passes task ids and filter values that can come from a user, so a shell is an injection path unless every argument is escaped correctly. Options to weigh: resolve the bin on win32 and start it through `node` with its JS entry; a vetted dependency such as cross-spawn (the package has zero runtime dependencies today); or a shell with strict cmd.exe escaping. The test fixture's fake executable is a POSIX `sh` script and needs a Windows form too. Whatever the choice, the resolution order BRANCHLING_BIN, then PATH stays.

## Steps

1. Compare the options against injection safety, zero runtime dependencies and the resolution order; record the choice in the commit body
2. Make the adapter start a .cmd shim on win32
3. Make the test helpers spawn the fixture the same way, and give the fake executable a Windows form
4. Get the windows-latest job green

## Acceptance criteria

- [ ] The contract tests pass on this platform. [proof: suite]
- [ ] The windows-latest job of the test workflow is green on the commit that closes this task. [proof: windows-ci]
