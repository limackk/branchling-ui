---
id: UI-38
title: "The adapter reads decide and where as envelopes"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done
owner: agent:loop-a
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-03
updated: 2026-11-03
blocked_by: [UI-14]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: envelopes
    bash: "npm test && ! grep -q parseDecideOutput src/adapter.mjs"
---

## Goal

The adapter reads `decide --json` and `where --json` as standard envelopes, as branchling 0.3.0 now prints them (TL-528), so the dedicated decide reader goes and the web entry takes the backlog root from `where` instead of a `stats` call.

## Context

branchling 0.3.0 (npm, 2026-11-03) ships TL-528: `decide` and `where` answer in the JSON envelope with schemaVersion and a declared kind. src/adapter.mjs still has parseDecideOutput, which reads exactly the two bare 0.2 shapes and fails loudly on anything else, and bin/branchling-ui.mjs takes the backlog root from the `root` of one `stats --json` because `where --json` had no envelope (UI-3, UI-22 gap 5). UI-23 lists the decide envelope as its gap 3; the other UI-23 gaps (open-questions listing, options, actor source) are still upstream (TL-536, TL-537). Follow the ui-adapter skill: typed calls, contract tests over a fixture backlog, refusals by refusalKind. Read the 0.3.0 envelope shapes from the installed binary, not from this text.

## Steps

1. Check the decide and where envelopes of the pinned 0.3.0: their kind, keys and the decide refusal shape
2. Replace parseDecideOutput with parseEnvelope and map a decide refusal by refusalKind
3. Add a typed `where()` call and take the backlog root from it in bin/branchling-ui.mjs and bin/branchling-ui-tui.mjs
4. Update the contract tests, and note in UI-22 and UI-23 which of their gaps 0.3.0 closed

## Acceptance criteria

- [x] decide and where are read as envelopes through the pinned branchling, and the dedicated decide reader is gone. [proof: envelopes]
