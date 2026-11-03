---
id: UI-30
title: "The task panel takes, releases and hands off a task"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: done
owner: agent:loop-a
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: [UI-27]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: task-actions
    bash: "node --test test/task-actions.test.mjs test/adapter.test.mjs"
  - id: actions-screens
    manual: "The panel's actions were checked with the ui-verify skill in light and dark, keyboard only, including a refusal."
---

## Goal

From the task panel a person can take a task, release it back to the queue and hand it off to a role, each through the branchling command, with the refusal shown unchanged when branchling refuses.

## Context

Part of the 'Without a release' wave (2026-11-02): work the pinned branchling 7d76538 already supports, done while the next branchling release is prepared. Read docs/design/README.md ('Screens and their data'), the matching mockup in docs/design/mockups/, docs/architecture.md and the ui-web and ui-verify skills first. A view is one module in src/views/ plus one line in src/views/index.mjs, its view model is pure functions in src/view-model/, and reads go through the cache join in bin/branchling-ui.mjs. Tests run with `npm test` (the pinned branchling); fixtures use only commands the pin has. The pinned branchling has `take`, `release` and `handoff`; `set` (UI-6) and `done` are not part of this task. Writes follow the decided rules in docs/architecture.md (UI-5): POST routes behind the Origin and capability guard, a JSON body read only after the guard, no `--actor` passed and a body naming one refused, the recorded actor shown in the answer, the cache invalidated after a write. Mockup: docs/design/mockups/flows.html. Add typed adapter calls with contract tests per the ui-adapter skill.

## Steps

1. Add `take`, `release` and `handoff` to src/adapter.mjs with contract tests, including a refusal for each
2. Add the write routes and the panel's actions with confirmation where the mockup shows one
3. Show the refusal text unchanged and the recorded actor after a write
4. Test the routes over a fixture: each action changes the task, each refusal is the refusal state, a foreign Origin is refused, and the panel is fresh after a write

## Acceptance criteria

- [x] Take, release and handoff change a fixture task through branchling, each refusal reaches the page unchanged, a foreign Origin is refused, and the panel is not stale after a write. [proof: task-actions]
- [x] The panel's actions were checked with the ui-verify skill in light and dark, keyboard only, including a refusal. [proof: actions-screens]
