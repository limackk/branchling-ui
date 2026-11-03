---
id: UI-37
title: "The task panel shows the task's body once branchling can print it"
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
  - id: panel-body
    bash: "node --test --test-name-pattern='body' test/task-panel.test.mjs"
---

## Goal

The task panel (UI-27) shows the task's markdown body, rendered through the safe subset already in src/view-model/task.mjs, instead of the notice that the body is not available.

## Context

Found while building UI-27 (2026-11-02). The pinned branchling 0.2.0 (7d76538) has no read that prints a task's body as JSON: `show --help` says the body is never reprinted ('read the file'), `query --text` matches id and title only, `log` carries history, `resume` is a successor briefing that needs the owner as actor, and `body` (TL-523) is a write. This package may not read task files (AGENTS.md), so the panel shows a Body section saying the body is not available (`body.known: false`) and never shows it as empty. Everything else is ready: markdownBlocks/markdownInlines/safeHref are built and tested on strings, and readTask in src/adapter.mjs needs one more read. Upstream needs a read contract, for example `show <ID> --json --body` adding a `body` string to task-show, or `body <ID> --print --json` with its own kind. File it in limackk/branchling and name it in blocked_by here.

Upstream: TL-542 in the branchling repository (filed 2026-11-03), `show <ID> --json --body` adding a `body` string to task-show, for active and archived tasks.

## Steps

1. File the upstream issue in limackk/branchling describing the read as a CLI contract (command, flag, envelope kind and the body key) and record its id here
2. When a branchling release has it, raise SUPPORTED_RANGE per the ui-adapter skill, add the typed adapter call with a contract test, and pass the body string from readTask to taskPanelModel
3. Test that a fixture task's body renders as headings, lists, code and links, and that HTML in a real body is shown as text

## Acceptance criteria

- [ ] A fixture task's real body is shown through the safe markdown subset, HTML as text. [proof: panel-body]
