---
id: UI-20
title: "The terminal interface reads through the cache and checks the range"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending
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
  - id: tui-cache
    bash: "node --test test/tui.test.mjs && grep -q createCache bin/branchling-ui-tui.mjs"
---

## Goal

bin/branchling-ui-tui.mjs wraps the adapter in UI-2's createCache (src/cache.mjs) and runs the same branchling version range check at startup as the web entry, so the TUI shows stale answers instead of waiting ~500 ms on every refresh and refuses an unsupported branchling the same way the web interface does.

## Context

UI-16 started the TUI with a bare createAdapter(...) and no adapter.version() check, because the cache was being wired into the web entry by another task at the same time and bin/branchling-ui.mjs was off limits. runTui only needs an object with stats(); src/tui/app.mjs already shows the stale state while a refresh is in flight, so no TUI rendering change should be needed.

## Steps

1. Read bin/branchling-ui.mjs to see how the web entry wires createCache and the version check
2. Do the same in bin/branchling-ui-tui.mjs, passing the cached adapter to runTui
3. If the cache reports freshness, feed it into statsModel in src/tui/app.mjs instead of the TUI's own stale flag
4. Add tests in test/tui.test.mjs for an unsupported version and for a cached answer

## Acceptance criteria

- [ ] the TUI entry reads through the cache and its tests pass [proof: tui-cache]
