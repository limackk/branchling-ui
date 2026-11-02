---
id: UI-23
title: "The decisions view reads open questions through one upstream contract"
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
  - id: decisions-contract
    bash: "npm test -- --test-name-pattern='decisions|decide' && ! grep -q parseDecideOutput src/adapter.mjs"
---

## Goal

The decisions view lists open questions with one branchling call, shows each question's options and recommendation, reads decide's answer as a standard envelope, and cannot record a person's answer under branchling's default agent actor. Today UI-5 spawns one log per active task, offers only a free-text answer, and parses decide's non-envelope output with a dedicated reader.

## Context

Found while building UI-5 against the pinned branchling 0.2.0. (1) No command lists open questions across the backlog: listDecisions() in src/adapter.mjs runs `query --json` once and then `log <ID> --decisions --json` for every active task, 4 at a time, about 0.45 s per spawn, so the view's cost grows with the backlog. (2) `log <ID> --decisions --json` omits a question's `options` and `recommend` (which `ask --json` and `resume --json` carry), so the radio-button answer built in src/web/decisions.mjs never appears. (3) `decide --json` prints no envelope: no schemaVersion, no kind of its own; a refusal puts its kind in `kind` rather than `refusalKind`/`refusal`; an unknown task exits 2 where other refusals exit 1. src/adapter.mjs parseDecideOutput reads exactly the two 0.2 shapes and fails loudly on anything else. (4) decide's argument parser has no `--` terminator or `--flag=value`, so an answer starting with '-' is refused by the UI. (5) When no actor is configured, decide falls back to the default agent actor silently, and its JSON does not say which source named the actor, so a person's answer can be recorded as an agent's; the page shows the recorded actor so it is visible. Option (a): file these upstream as CLI contracts and map them here once released and pinned. Option (b): read history/*.jsonl or task files for the options and the open set; rejected, AGENTS.md forbids reading backlog files outside the adapter's CLI calls. (a) is the solid choice.

## Steps

1. Re-check each of the five gaps against the pinned branchling; drop any a newer pinned release already fixed
2. File the remaining ones as issues in limackk/branchling, each stated as a CLI contract (command, flags, envelope kind and keys), and record their ids in this task
3. Once released and pinned: replace the per-task log calls in listDecisions() in src/adapter.mjs with the new command, read options from it, replace parseDecideOutput with parseEnvelope, and refuse or warn when the actor came from the default
4. Extend test/decisions-view.test.mjs: options shown for a question asked with --option, one spawn for the list, a reason starting with '-' recorded

## Acceptance criteria

- [ ] the decisions view reads standard envelopes from one listing call [proof: decisions-contract]
