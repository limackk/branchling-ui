---
id: UI-18
title: "Views take status and priority vocabulary from the CLI"
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
blocked_by: []  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: vocabulary-contract
    bash: "node --test --test-name-pattern=vocabulary test/adapter.test.mjs"
---

## Goal

Views colour and order statuses and priorities from the backlog's own vocabulary, read through the adapter, so a backlog with renamed or extra statuses renders correctly instead of falling back to a neutral palette.

## Context

Found while analysing UI-1 on 2026-11-02. UI-1 and UI-16 both ask for status and priority colours derived from config.yaml, but the UI may not read config.yaml (AGENTS.md: the adapter is the only door), and no branchling command returns the vocabulary as JSON: `stats --json` gives only the keys of byStatus and byPriority, with no order, no archived set and no colour role; `doctor --json` names a `vocabulary` check, not the values. This is a missing CLI capability, so per AGENTS.md it is an upstream task in the branchling repository, tracked here. Until it ships, views use a neutral palette for every status and derive only what the envelopes already say. The upstream task is not filed yet: file it in limackk/branchling and add its TL id to this task's context.

Upstream: TL-532 in the branchling repository (filed 2026-11-02), a `vocabulary` envelope with statuses in order, roles, the archived set and the declared releases.

## Steps

1. File the upstream task in limackk/branchling: a `--json` envelope with the configured statuses in order, the archived set, priorities in order and any colour roles, with its kind and schemaVersion
2. Once it is released inside SUPPORTED_RANGE, add a typed adapter call and a contract test over a fixture backlog with a non-default vocabulary, following the ui-adapter skill
3. Replace the neutral fallback in the shared view model with roles taken from that envelope

## Acceptance criteria

- [ ] The adapter returns the configured status and priority vocabulary for a fixture backlog with a non-default vocabulary. [proof: vocabulary-contract]
