---
id: UI-15
title: "Agents find how a CLI capability enters the adapter"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: done
owner: agent:claude
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
  - id: skill
    bash: "test -f .agents/skills/ui-adapter/SKILL.md && test -L .claude/skills/ui-adapter && grep -qx 'name: ui-adapter' .agents/skills/ui-adapter/SKILL.md"
  - id: names-real-code
    bash: "for s in createAdapter parseEnvelope BranchlingRefusal BranchlingUsageError ContractMismatch SUPPORTED_RANGE SUPPORTED_SCHEMA_VERSIONS; do grep -q \"$s\" src/adapter.mjs && grep -q \"$s\" .agents/skills/ui-adapter/SKILL.md || exit 1; done"
  - id: suite
    bash: "npm test"
---

## Goal

An agent asked to make the interface show or do something new finds, in one skill, how a branchling capability enters this package: through a typed adapter call with a contract test, or as an upstream task when the CLI cannot do it yet.

## Context

Every view task (UI-3 to UI-8) starts by needing data or an action from branchling, and the rules for that live only in AGENTS.md as prohibitions. An agent knows what not to do but not the procedure: which envelope kind to expect, how a refusal differs from a usage error, how to write the contract test against the real executable, when SUPPORTED_RANGE moves. The skill follows branchling upstream's skill shape (a short SKILL.md that triggers on the phrases people use, with the rules and the reasons) and the backlog-workflow precedent of not copying what a command prints. It is written now because the adapter is the only code that exists; the web and terminal skills wait for the decisions they would describe (UI-1, UI-16).

## Steps

1. Write .agents/skills/ui-adapter/SKILL.md
2. Symlink .claude/skills/ui-adapter to it
3. Point AGENTS.md at the skill

## Acceptance criteria

- [x] The skill exists for Codex and Claude with valid frontmatter. [proof: skill]
- [x] Every adapter symbol the skill names exists in src/adapter.mjs. [proof: names-real-code]
- [x] The contract tests still pass. [proof: suite]
