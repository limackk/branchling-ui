---
id: UI-24
title: "An undeclared name reaches the page as branchling's own refusal"
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
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: unknown-name-refusal
    bash: "npm test -- --test-name-pattern='unknown-name'"
---

## Goal

An undeclared release, target or stage name is a refusal envelope from branchling, so the interface maps it like every other refusal and the interim guess in src/request-error.mjs (rejectingTypedInput) is deleted. The release view then also lists the declared releases from data instead of saying the list is unknown.

## Context

UI-21 shipped an interim route: branchling 0.2.0 rejects `deploy status --json --release nope` (also --target, --env) with exit 2 and stderr only, no envelope, so rejectingTypedInput assumes that a usage error on a call carrying typed names is the names' fault and answers 422 rejected-input. That guess misattributes a wrongly built flag on such a call, and no pinned command gives the declared releases as JSON, so the page can only show branchling's stderr for them. The upstream contract to ask for: on an undeclared --release/--target/--env, `deploy status --json` prints a `release-status` envelope with refusalKind `unknown-name`, `refusal`, `rejected: { flag, value }` and `declared: [...]`, exit 1; plus the declared releases as data (in the unfiltered release-status envelope or a vocabulary command, see UI-18). Rejected alternative: parsing the '(declared: …)' text in stderr, which AGENTS.md forbids.

## Steps

1. File the contract above as an issue in limackk/branchling and record its id here.
2. Once a release with it is pinned: map refusalKind unknown-name to the rejected state in src/view-model/states.mjs from the envelope's rejected/declared keys.
3. Delete rejectingTypedInput and its use in src/views/release.mjs; keep the tests for the rejected state, now fed by the real refusal.
4. Show the declared releases as links in the rejected state.

## Acceptance criteria

- [ ] An undeclared name reaches the page as branchling's own refusal, with the declared names from data. [proof: unknown-name-refusal]
