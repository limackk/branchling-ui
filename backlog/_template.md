---
# ╭─────────────────────────────────────────────────────────────────────────╮
# │  TASK TEMPLATE. `branchling new --title "…"` copies this file, assigns    │
# │  the number and fills in the dates — you do not have to copy it.       │
# │  The vocabularies (statuses, priorities, labels) come from the         │
# │  `config.yaml` of YOUR backlog; the values below are only the          │
# │  defaults written by `branchling init`.                                   │
# ╰─────────────────────────────────────────────────────────────────────────╯
id: <PREFIX>-NNN                   # prefix from `task_id_prefix` in config.yaml; the number comes from `branchling new`
title: ""                          # imperative, short
type: task
labels: []
board: main                        # a CLOSED vocabulary (boards.yaml); do not guess: `branchling board <file>`
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: pending
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: YYYY-MM-DD
updated: YYYY-MM-DD                # set to today on every status change
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: the-name                   # optional; a criterion below points at this id
    bash: "command to run"         # THE PLACEHOLDER: `done` refuses this text, and until you replace it the guards read this entry as one nobody has written
---

## Goal

Why this task exists, and what has to be true once it is done.

## Context

What the next person has to know before they start. They were not part of the
conversation this task came out of: where it came from, what has already been
tried, which alternatives were rejected and why.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `path/to/file` — what to look at there

## Steps

1. ...

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence.
Replace the example below together with the example verification entry. Until
its exact sentence and proof id change, the criteria guard recognises it as the
template's placeholder rather than as an authored link.

- [ ] Verifiable, not subjective. [proof: the-name]
