---
id: UI-13
title: "Outside contributors find how to contribute"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
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
  - id: files
    bash: "git ls-files --error-unmatch CONTRIBUTING.md SECURITY.md SUPPORT.md .github/ISSUE_TEMPLATE/bug_report.yml .github/ISSUE_TEMPLATE/feature_request.yml .github/ISSUE_TEMPLATE/config.yml .github/pull_request_template.md"
  - id: readme-links
    bash: "grep -q 'CONTRIBUTING.md' README.md && grep -q 'github.com/limackk/branchling' AGENTS.md"
  - id: check
    bash: "branchling check"
---

## Goal

Somebody arriving from GitHub, with or without an agent, can find how to set up, test, pick a task and report a problem without asking the maintainer.

## Context

The repository had a README and an AGENTS.md but no CONTRIBUTING, SECURITY or SUPPORT file and no issue templates. The texts follow branchling upstream's own (DCO sign-off, private vulnerability reporting, best-effort support) adapted to this package: the extra rule that a missing branchling capability is filed upstream rather than worked around here, the pinned devDependency from UI-11, and the agent setup from UI-12, including how to register the MCP server in Codex. AGENTS.md gains a link to the upstream repository so the TL- task references resolve for a stranger.

## Steps

1. Write CONTRIBUTING.md
2. Write SECURITY.md and SUPPORT.md
3. Add .github/ISSUE_TEMPLATE (bug report, feature request, config) and a pull request template
4. Point the README at CONTRIBUTING and the agent setup; link upstream from AGENTS.md

## Acceptance criteria

- [x] The contributor documents and templates are tracked. [proof: files]
- [x] The README points at the contribution guide and AGENTS.md links the upstream repository. [proof: readme-links]
- [x] The backlog guards pass. [proof: check]
