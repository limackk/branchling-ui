---
id: UI-22
title: "A broken plan reads as broken, not as a bug or an empty plan"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
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
  - id: plan-refusal
    bash: "npm test -- --test-name-pattern='contradict|unparsable'"
---

## Goal

The plan view can tell a plan that contradicts blocked_by, or does not parse, from a valid plan, and its fixture creates the plan through branchling instead of writing plan.yaml by hand. Today both broken cases either read as an interface bug or as an empty plan, and a stale-looking answer is worse than an error.

## Context

Found while building UI-3 against the pinned branchling 0.2.0. (1) A plan that contradicts `blocked_by`: `plan --json` exits 1 with empty stdout and the message on stderr, so the adapter throws BranchlingUsageError and the page says the interface called branchling incorrectly, although `plan --help` says this case is REFUSED. (2) An unparsable plan.yaml (`waves: [oops`) answers `exists: true, waves: []`, exit 0, so the view shows an empty plan (viewer brief section 7.5 asks to say the plan does not parse). (3) No command creates a plan: `plan add --why` on a backlog without plan.yaml answers 'there is no plan to edit', and `seed`'s `wave` key accepts only an existing wave, so test/fixtures/plan-backlog.mjs writes a two-line plan.yaml by hand. (4) `plan --json` carries no titles and no blocked_by edges; UI-3 fills them with one `query --json` call, which only returns active tasks, so a closed planned task shows its id without a title. (5) `where --json` prints no schemaVersion/kind envelope, so bin/branchling-ui.mjs takes the backlog root from `stats --json` instead. Option (a): file these upstream as CLI contracts (a `plan` envelope with refusalKind for a contradiction and for a parse failure; `plan init --rationale`; titles and blocked_by per wave task; `where` as an envelope) and map them here once released. Option (b): detect them in the UI from stderr text or by reading plan.yaml; rejected, it parses human output and reads a backlog file, both forbidden by AGENTS.md. (a) is the solid choice.

Upstream (filed 2026-11-02 in the branchling repository): TL-534 for gaps 1, 2 and 4 (refusals for a broken plan, titles and blockers per planned task), TL-535 for gap 3 (`plan init --rationale`), and the existing TL-528 for gap 5 (`where --json` in the envelope).

## Steps

1. Re-check each of the five gaps against the pinned branchling; drop any that a newer pinned release already fixed.
2. File the remaining ones as issues in limackk/branchling, each stated as a CLI contract (command, flags, envelope kind and keys), and record their ids in this task's context and blocked_by tracking.
3. Once released and pinned: map the plan refusal to the refusal state in src/view-model/plan.mjs, replace the hand-written plan.yaml in test/fixtures/plan-backlog.mjs with the new command, and drop the extra query call if the plan envelope carries titles and edges.
4. Add tests in test/plan-view.test.mjs for a contradicting plan (refusal state, not error) and an unparsable plan (not the empty state), each with a positive control.

## Acceptance criteria

- [ ] A plan that contradicts blocked_by is the refusal state and an unparsable plan is not shown as empty. [proof: plan-refusal]
