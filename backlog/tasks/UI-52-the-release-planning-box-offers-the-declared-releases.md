---
id: UI-52
title: "The release planning box offers the declared releases"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done
owner: agent:loop-ui-52
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: declared-releases
    bash: "node --test --test-name-pattern='declared releases' test/release-manage.test.mjs"
---

## Goal

The release planning box offers the releases config.yaml declares, read from the vocabulary envelope, instead of only the releases the page has seen. A person picking a release to plan a task for then sees every declared release, in declared (chronological) order, and the box says so; the 'seen' list stays as the fallback when the executable has no vocabulary command.

## Context

Found while doing UI-44 (rejected typed values name the declared values from adapter.vocabulary()). src/view-model/release-planning.mjs (header 'WHICH RELEASES ARE DECLARED', seenReleases, PLANNING_TEXT.seenNote) still says no read of branchling returns releases: as data. Since UI-18 / upstream TL-532 the vocabulary envelope carries releases: [{ name, ref }] in declared order, and the page already loads /api/vocabulary (src/web/app.mjs). adapter.vocabulary() resolves null on branchling 0.3.0, the floor of SUPPORTED_RANGE, so the seen list must stay for that case.

## Steps

1. Read src/view-model/release-planning.mjs (seenReleases, PLANNING_TEXT) and the release planning part of src/web/release.mjs and the terminal release screen
2. Add a model function that returns the declared releases from a vocabulary envelope, or null when it is null or has no releases array
3. Offer the declared list (labelled as declared) when known, and the seen list (labelled as seen) otherwise; update the header comment and seenNote
4. Test both cases in test/release-manage.test.mjs with test names containing 'declared releases'

## Acceptance criteria

- [x] The planning box offers the declared releases from vocabulary, and the seen releases when vocabulary is null [proof: declared-releases]
