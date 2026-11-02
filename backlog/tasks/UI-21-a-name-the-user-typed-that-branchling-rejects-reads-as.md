---
id: UI-21
title: "A name the user typed that branchling rejects reads as their mistake"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done
owner: agent:loop-c
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
  - id: typed-name
    bash: "node --test --test-name-pattern='typed name' test/view-model.test.mjs"
---

## Goal

When a view passes a name the user typed (a release, a target, a stage) and branchling rejects it, the page says the name is not declared and lists what is, instead of the heading 'The interface called branchling incorrectly'.

## Context

Found while building UI-4. `branchling deploy status --release nope` exits 2 with only stderr ('`nope` is not a declared release (declared: 1.0, 1.1)') and no envelope, so the adapter throws BranchlingUsageError and the server answers 500 usage-error. The shared error state in src/view-model/states.mjs titles every usage error as a bug in this package, which is right for a flag we built wrongly and wrong for a value the user typed. Options: (a) file upstream for an envelope with a refusalKind (e.g. unknown-name) on an undeclared vocabulary value, then map it to the refusal state; (b) have the view validate names against a list it already holds (the release-status envelope's targets and refs) before calling. (a) composes with the existing refusal path and is the solid choice; (b) duplicates branchling's vocabulary in the UI. Until the upstream envelope exists, a view may route a usage error caused by a user-typed value to a distinct error title.

## Steps

1. Check whether the pinned branchling returns an envelope for an undeclared --release/--target; if not, file the upstream issue in limackk/branchling and record it in blocked_by.
2. Add a distinct state in src/view-model/states.mjs (or map the refusal) for a rejected user-typed name, with a test.
3. Use it from the release view's selection form.

## Acceptance criteria

- [x] A rejected user-typed name becomes its own state, not the interface-bug error. [proof: typed-name]
