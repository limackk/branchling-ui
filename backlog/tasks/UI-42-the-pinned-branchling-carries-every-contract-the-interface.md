---
id: UI-42
title: "The pinned branchling carries every contract the interface reads"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: blocked
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-04
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: pinned-green
    bash: "env -u BRANCHLING_BIN npm test"
---

## Goal

The devDependency, package-lock and SUPPORTED_RANGE name a published branchling release that carries TL-532 to TL-546, and `npm test` passes without BRANCHLING_BIN.

## Context

UI-18, UI-22, UI-23, UI-24, UI-33, UI-34, UI-37 and UI-39 were built and closed on 2026-11-04 against branchling's unreleased main through BRANCHLING_BIN, because the release that carries their upstream tasks (TL-532 to TL-546) had not been published; the pin stayed at 0.3.0 on purpose. Under plain `npm test`, and in CI, the suite runs the pinned 0.3.0, which lacks `vocabulary`, `set --fields`, `show --body`, `log --open-questions`, `query --scope`, actorSource and the newer refusal envelopes, so those tests fail there. Each loop listed what the pin step must also settle: whether SUPPORTED_RANGE.min rises, with a test that fails for a build outside the range (main still reports 0.3.0); dropping the fallbacks that a raised min makes unreachable (the `bodyFlagUnknown` memo in adapter.show and the `setFieldsFlagUnknown` path in adapter.setFields, with their stub tests in test/task-panel.test.mjs and test/field-edit.test.mjs); and the vocabulary contract test in test/adapter.test.mjs, which is skipped on CI until then.

## Steps

1. Wait for a branchling release that carries TL-532 to TL-546
2. Move the devDependency, package-lock and SUPPORTED_RANGE to it, with a test that fails for a build outside the range
3. Remove the fallbacks the new minimum makes unreachable, with their stub tests
4. Run the suite without BRANCHLING_BIN

## Acceptance criteria

- [ ] The whole suite passes against the pinned branchling, with no BRANCHLING_BIN override. [proof: pinned-green]
