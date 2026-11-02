---
id: UI-29
title: "The overview says what needs a person and where the backlog stands"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: done
owner: agent:loop-b
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: [UI-26, UI-28]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: overview
    bash: "node --test test/overview.test.mjs"
  - id: overview-screens
    manual: "The overview was checked with the ui-verify skill in light and dark at 375 px and desktop width, keyboard only."
---

## Goal

Opening the interface lands on an Overview that answers two questions at a glance: what needs me (open questions, failing checks, blocked tasks) and where do we stand (the active wave, what is in flight, the totals), each linking to the view that has the detail.

## Context

Part of the 'Without a release' wave (2026-11-02): work the pinned branchling 7d76538 already supports, done while the next branchling release is prepared. Read docs/design/README.md ('Screens and their data'), the matching mockup in docs/design/mockups/, docs/architecture.md and the ui-web and ui-verify skills first. A view is one module in src/views/ plus one line in src/views/index.mjs, its view model is pure functions in src/view-model/, and reads go through the cache join in bin/branchling-ui.mjs. Tests run with `npm test` (the pinned branchling); fixtures use only commands the pin has. Mockup: docs/design/mockups/overview.html. Data: `stats`, `plan`, `doctor` and the open questions the decisions view already lists; every count comes from an envelope, none is derived from status names. It becomes the default view (no `view` param); the stats view either folds into it or stays reachable, decided against the mockup and recorded in docs/architecture.md.

## Steps

1. Add the overview view model combining the envelopes, each part with its own state so one failing read does not blank the page
2. Add the route and page module and make it the default view
3. Decide what happens to the separate stats view and record it
4. Test the view model and the route over a fixture with an open question, a failing check and an active wave

## Acceptance criteria

- [x] The overview shows open questions, failing checks and the active wave for a fixture backlog, and one failing read leaves the other parts shown. [proof: overview]
- [x] The overview was checked with the ui-verify skill in light and dark at 375 px and desktop width, keyboard only. [proof: overview-screens]
