# branchling-ui

A visual interface for branchling backlogs: task views, execution plan,
release pipeline, decisions waiting on a person. It is a separate package and
a CONSUMER of branchling, never a part of it.

## The one rule: the CLI contract is the only door

- Everything goes through `src/adapter.mjs`, which spawns the installed
  `branchling` executable (`BRANCHLING_BIN`, else `branchling` on PATH) with
  `--json`. No other module spawns branchling or reads a backlog file.
- **Never import branchling's `scripts/`.** They are an implementation, not a
  library; branchling deliberately has no plugin API.
- **Never write a task file directly.** Every write is a branchling command
  (`take`, `done`, `handoff`, `plan move`, `new`, and the field, release, body
  and watch commands tracked upstream as TL-521 to TL-525). Writing the
  markdown here would bypass validation, attribution, required reasons and the
  history log.
- **A missing capability is an upstream task, not a workaround here.** File it
  in the [branchling repository](https://github.com/limackk/branchling) and
  track the dependency in this backlog. The `TL-` ids above are tasks there.
- `SUPPORTED_SCHEMA_VERSIONS` and `SUPPORTED_RANGE` in the adapter are the
  compatibility promise. Moving either is a deliberate change with tests.

## Tests

```bash
node --test test/*.test.mjs
```

Contract tests run against the REAL executable over a fixture backlog built in
a temporary directory. Never assert values from this repository's own backlog.

## Conventions

- Everything in this repository is English, including commits and branch names.
- One task, one commit; the title starts with the task id and states what is
  now true, up to 72 characters, no trailing full stop; the body says why.
- Branch and worktree names: `ui-<number>-<short-english-slug>`.
- `git push` needs an explicit request.

<!-- >>> branchling:instructions v1 -->
## The backlog

This repository's tasks live in markdown files driven by `branchling`. Before you
work on anything from the backlog, run:

```bash
branchling instructions overview
```

That command IS the current instruction. It ships with the tool, so it cannot
describe flags the tool no longer has, and it is rendered with this backlog's
own vocabulary. Do not copy its output back into this file.
<!-- <<< branchling:instructions -->
