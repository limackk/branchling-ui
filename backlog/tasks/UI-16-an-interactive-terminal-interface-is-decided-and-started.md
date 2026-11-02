---
id: UI-16
title: "An interactive terminal interface is decided and started"
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
estimate: 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: [UI-1]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: tui-tests
    bash: "node --test test/tui.test.mjs"
  - id: tui-skill
    bash: "test -f .agents/skills/ui-terminal/SKILL.md && test -L .claude/skills/ui-terminal && grep -q 'TUI' docs/architecture.md"
---

## Goal

The package has an interactive full-screen terminal interface, decided and started: its library, its keyboard model and its terminal rules are written down, and one screen shows `stats` through the adapter, rendered from the same view model the web interface uses.

## Context

The maintainer decided on 2026-11-02 that the terminal surface is an interactive TUI (in the style of lazygit or k9s), not only formatted command output. Until then every view task assumed a web page. The TUI must hold to the same rules as the web interface: the adapter is the only door, nothing writes a task file, and it works on any repository's backlog. It renders the shared view model UI-1 defines, so the two surfaces cannot drift. Terminal rules to carry over from branchling's own output style: NO_COLOR, TERM=dumb, TTY checked per stream, the 16 ANSI colours that respect the user's theme, colour roles derived from config.yaml rather than hard-coded status names. TUI-specific: alternate screen and cursor restored on every exit path including a crash and SIGINT, resize, a visible key map, Windows terminals. Options to compare include Ink (React for terminals), a lower-level library, and no dependency at all, the precedent branchling sets.

## Steps

1. Compare at least two TUI approaches against the constraints and Windows support; record the decision in docs/architecture.md
2. Add the TUI entry point with one stats screen fed by the shared view model
3. Test rendering at 80 columns, with NO_COLOR, and that the terminal is restored after an exception
4. Write .agents/skills/ui-terminal/SKILL.md (with the symlink in .claude/skills) describing the decided conventions

## Acceptance criteria

- [x] The stats screen renders at 80 columns, emits no ANSI codes under NO_COLOR, and restores the terminal after an exception. [proof: tui-tests]
- [x] The terminal conventions are a skill and the decision is recorded. [proof: tui-skill]
