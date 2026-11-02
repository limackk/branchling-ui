---
id: UI-12
title: "Claude and Codex share one agent setup"
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
  - id: one-skill
    bash: "test -f .agents/skills/backlog-workflow/SKILL.md && test -L .claude/skills/backlog-workflow && cmp .agents/skills/backlog-workflow/SKILL.md .claude/skills/backlog-workflow/SKILL.md"
  - id: configs-parse
    bash: "node -e \"for (const f of ['.claude/settings.json','.codex/hooks.json','.mcp.json']) JSON.parse(require('fs').readFileSync(f,'utf8'))\""
  - id: hook-runs
    bash: "echo '{\"tool_input\":{\"file_path\":\"README.md\"}}' | sh -c \"$(node -e \"console.log(require('./.claude/settings.json').hooks.PostToolUse[0].hooks[0].command)\")\""
  - id: doctor
    bash: "branchling doctor"
---

## Goal

Claude Code and Codex start in this repository with the same skill, the same view-rebuild hook and a ready MCP server for the backlog, and a contributor's agent gets read-only branchling and test commands without a permission prompt for each.

## Context

The skill lived only in .claude/skills, which Codex does not read; Codex reads repository skills from .agents/skills. branchling upstream solves this by keeping the skill in .agents/skills and symlinking .claude/skills to it, and by shipping .claude/settings.json and .codex/hooks.json with a PostToolUse `regen-hook`. This repository follows the same layout so the two agree. The hook resolves the executable the way the adapter does (BRANCHLING_BIN, then the pinned node_modules copy from UI-11, then PATH). `.mcp.json` registers `branchling mcp` for any MCP client that reads it; Codex registers MCP servers through its own command, which CONTRIBUTING (UI-13) names. The shared permission list is deliberately read-only plus tests and `branchling new`: writing commands such as take and done stay a prompt, because outside contributors run this file too. `agent:codex` joins the actors vocabulary; branchling 0.2.0 does not refuse unlisted actors, so this is documentation, not a gate.

## Steps

1. Move the skill to .agents/skills/backlog-workflow and symlink .claude/skills/backlog-workflow to it
2. Add .claude/settings.json with the regen hook and a read-only permission list
3. Add .codex/hooks.json with the same hook
4. Add .mcp.json registering branchling mcp
5. Add agent:codex to actors in backlog/config.yaml

## Acceptance criteria

- [x] Claude and Codex read one skill file. [proof: one-skill]
- [x] The agent configuration files are valid JSON. [proof: configs-parse]
- [x] The configured hook command runs and exits zero. [proof: hook-runs]
- [x] The backlog still passes doctor with the skill in its new place. [proof: doctor]
