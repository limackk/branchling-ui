---
id: UI-39
title: "The field edits take their fields and values from branchling as data"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done
owner: agent:lane-u1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-03
updated: 2026-11-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: set-fields-data
    bash: "node --test --test-name-pattern='fields from branchling' test/*.test.mjs"
---

## Goal

The field edits in the task panel take their field list and current values from branchling as data, can set any value branchling accepts, and tell a missing reason or an out-of-vocabulary value apart from other refusals, instead of relying on a list written down in src/view-model/task-fields.mjs.

## Context

Found while building UI-6 on branchling 0.3.0. (1) No command returns the fields `set` edits as data; EDITABLE_FIELDS is written down and a contract test compares it with the 'editable: …' details line of the `usage` refusal (human text, not used at runtime). (2) `confidence` and the declared `blocks` are in no read (query rows, show), so their edit box starts empty and the panel says 'not reported'. (3) `set` has no end-of-options `--`, so a legitimate value starting with '-' (a title '-x') cannot be set through the CLI; the adapter refuses it before spawning. (4) A value outside the vocabulary and a missing reason both come back as refusalKind `usage`, so the page cannot offer a targeted fix. The vocabularies themselves are UI-18. Contracts to ask for upstream: `set --fields --json` (kind task-set-fields: fields [{name, list, clearable, vocabulary|null}]) or the same as a key of the usage refusal envelope; confidence and blocks in query rows and show --json; `--` in set and the other writes; distinct refusalKinds such as `unknown-value` and `reason-required`. Rejected: reading the prose details line at runtime (human output, and a write-command spawn per panel).

Re-checked on branchling 0.3.0 (2026-11-03). Gap 3 is closed upstream: `set` accepts `--` before its positionals (scripts/set-field.mjs), and the adapter now passes the id, the field and the value after it, so a value that starts with '-' is set as written (the id, the field, the reason and the actor are still refused). A missing reason already answers refusalKind `reason-required`; only an out-of-vocabulary value is still `usage`. Upstream: TL-543 in the branchling repository (filed 2026-11-03) for gaps 1, 2 and the `unknown-value` kind.

Built on branchling main (2026-11-04), where TL-543 is merged but not released. `set --fields --json` drives the pens through readTask's `fields`; EDITABLE_FIELDS is gone (FIELD_LABELS is presentation only); confidence and blocks start from `show`; `unknown-value` and `reason-required` mark the box to fix. A build without `--fields` (0.3.0 as published) gives `fields: null` and a note instead of pens. The pin, SUPPORTED_RANGE and package-lock stay at 0.3.0 until a release carries TL-543, so the verification passes only with BRANCHLING_BIN pointing at branchling main.

## Steps

1. Re-check each gap on the pinned branchling and drop what a newer pin already fixed.
2. File the remaining contracts as issues in limackk/branchling and record their ids here.
3. Once released and pinned: build the field list and current values from the new data, drop EDITABLE_FIELDS, let values starting with '-' through, and map the new refusalKinds to targeted messages in src/view-model/task-fields.mjs, with tests in test/field-edit.test.mjs.

## Acceptance criteria

- [x] The editable fields and their current values come from branchling's own JSON. [proof: set-fields-data]
