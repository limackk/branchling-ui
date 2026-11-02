---
id: UI-11
title: "A fresh clone tests against the pinned branchling"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: in_progress
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: [UI-14]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: pinned-bin
    bash: "test -x node_modules/.bin/branchling && node -e \"const p=require('./package.json'); if(!p.devDependencies||!p.devDependencies.branchling||p.dependencies) process.exit(1)\""
  - id: lockfile
    bash: "git ls-files --error-unmatch package-lock.json .nvmrc .github/workflows/test.yml"
  - id: local-ignored
    bash: "git check-ignore -q .claude/settings.local.json && git check-ignore -q CLAUDE.local.md"
  - id: suite
    bash: "npm test"
---

## Goal

A fresh clone tests against the branchling release this package pins, on every supported Node line, without anyone installing branchling globally first, and CI shows that result on every push and pull request.

## Context

The contract tests spawned whatever `branchling` happened to be on PATH, so two contributors could test against different releases and both see green. There was no CI, so an outside reviewer had no run to read. branchling is published on npm (0.2.0), so it becomes a devDependency inside SUPPORTED_RANGE: `npm test` puts node_modules/.bin first on PATH, and the adapter still spawns an executable rather than importing a module, so the CLI-contract rule is untouched. Runtime dependencies stay at zero. Testing the minimum and the maximum of the range is UI-9 and is not done here. The .gitignore also gains the per-user agent files (Claude local settings and memory) so a contributor's own configuration cannot ride into a pull request.

## Steps

1. Add branchling ~0.2.0 as a devDependency and commit package-lock.json
2. Add .nvmrc with the Node line used locally and in CI
3. Add .github/workflows/test.yml: npm ci, npm test and branchling check on Node 18/20/22 on Linux and macOS, plus Windows on 22
4. Extend .gitignore with node_modules, *.tgz, .DS_Store, .claude/settings.local.json, CLAUDE.local.md and .env files

## Acceptance criteria

- [ ] branchling is a pinned devDependency and the package has no runtime dependencies. [proof: pinned-bin]
- [ ] The lockfile, the Node version file and the CI workflow are tracked. [proof: lockfile]
- [ ] Per-user agent files are ignored. [proof: local-ignored]
- [ ] The contract tests pass against the pinned executable. [proof: suite]
