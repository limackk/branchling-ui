---
name: ui-adapter
description: Bring data or an action from branchling into this interface. Covers src/adapter.mjs, the JSON envelope, typed adapter calls, refusals versus usage errors, the contract tests in test/, SUPPORTED_RANGE and SUPPORTED_SCHEMA_VERSIONS, and what to do when the branchling CLI cannot do something yet. Use this skill whenever a view or screen needs something it does not have, whenever work touches src/adapter.mjs or test/adapter.test.mjs, and for requests like "show X in the UI", "let the user change Y", "the UI needs Z from the backlog", "add support for the new branchling command", "bump the branchling version" — even if the word adapter never comes up.
---

# How a branchling capability enters this interface

The interface is a consumer of branchling, never a part of it. Everything it
knows about a backlog, and every change it makes to one, passes through one
module: `src/adapter.mjs`. That module spawns the installed `branchling`
executable with `--json`. It is the only module that spawns branchling, and
nothing in this package reads or writes a backlog file.

So every feature starts with one question: **does the branchling CLI already
answer this, as JSON?**

```bash
npx branchling --help              # which commands exist
npx branchling <command> --help    # its flags, and whether it takes --json
```

Ask the executable, not your memory or upstream's source. What upstream's
`main` can do and what the pinned build can do are two different answers, and
only the second one runs here.

## Yes: add a typed call

1. **Run the command on a fixture first** and read the envelope it prints:

   ```json
   { "schemaVersion": 1, "kind": "<kind>", "...": "keys declared for that kind" }
   ```

   Note the `kind`. The typed call asserts it, so a command whose output changes
   shape fails loudly instead of rendering `undefined`.

2. **Add a method to the object `createAdapter` returns**, next to `query`,
   `show` and the others. Pass the expected kind to `json(args, kind)`. For a
   writing command, the document goes on stdin through `json(args, kind,
   { input })`, the way `branchling new` takes a task body. Never assemble it
   into a temporary file of your own.

3. **Do not parse human output.** If the command has no `--json`, treat that as
   the "no" case below. Text output is for people and may change wording in any
   release.

4. **`raw` is for exploring, not for shipping.** A view that calls
   `adapter.raw([...])` has no asserted kind and no test. Promote the call to a
   typed method before a view depends on it.

## The three ways a call fails, and what each one means

| Error | When | What the UI does |
|---|---|---|
| `BranchlingRefusal` | branchling understood the request and declined. `refusalKind` is set, the exit is non-zero, and the envelope is attached as `err.envelope` | Show the refusal. It is an answer, often one the user must act on: a reason is required, the task is held by someone else |
| `BranchlingUsageError` | no envelope at all, only text on stderr: unknown flag, value outside the vocabulary | A bug in this package or a version mismatch. Log it; do not dress it up as a user-facing message |
| `ContractMismatch` | the output is not JSON, has an unsupported `schemaVersion` (see `parseEnvelope`), or the wrong `kind` | The installed branchling is not one this package supports. Say so, with the version |

Never catch one of these just to return an empty result. An empty list from a
refusal looks exactly like an empty backlog.

## No: it is an upstream task, not a workaround

When the CLI cannot do it, **do not** read `backlog/tasks/*.md`, import from
branchling's `scripts/`, or write a task file. Each of those bypasses
validation, attribution, required reasons and the history log, and couples this
package to internals branchling deliberately does not promise.

Instead:

1. Open an issue in [limackk/branchling](https://github.com/limackk/branchling/issues)
   describing the capability as a CLI contract: the command, its flags, the
   envelope `kind` and its keys.
2. Record the dependency in this backlog. Run `npx branchling instructions
   task-creation` first, then create a task that names the upstream issue or
   task id and keeps the view task `blocked_by` it.
3. Build the view up to the missing piece, if that is useful, and stop there.

The upstream `TL-` ids mentioned in `AGENTS.md` are exactly this: gaps found
here, filed there.

## The contract test is the proof

Every typed call gets a test in `test/adapter.test.mjs` (or a new
`test/*.test.mjs`) that runs against the **real executable**:

- Build the fixture with branchling's own commands (`init`, `new` with a body
  on stdin, `take`, and so on) in a temporary directory, as the existing
  `before()` does. Start them through the adapter's exported `run`, never
  `execFileSync`. On Windows the executable is a `.cmd` shim that only
  `run` knows how to start safely (UI-17). Never assert values from this repository's own `backlog/`.
  Its contents are data, and they change.
- Assert the `kind` and the keys the view will read.
- Pair every negative assertion with a positive control. A test that only
  checks "this refuses" also passes for a command that refuses everything.
- For a refusal, assert `err instanceof BranchlingRefusal` and the envelope's
  `kind`, as the unknown-task-id test does.

```bash
npm test                                     # runs against the pinned build
BRANCHLING_BIN=/path/to/branchling npm test  # against another build
```

`npm test` runs whatever `node_modules/.bin/branchling` is, which comes from
`package-lock.json`. A green run against a globally installed, newer branchling
proves nothing for the next person.

## Moving the compatibility promise

`SUPPORTED_SCHEMA_VERSIONS` and `SUPPORTED_RANGE` are the promise this package
makes to its users about which branchling they may run. Change either one only
on purpose:

- **A new call needs a newer branchling.** Raise `SUPPORTED_RANGE.min` to the
  first *published* release that has the command, and move the devDependency
  with it. A commit pin is a stopgap for development only (see UI-14).
- **A new envelope version.** Add it to `SUPPORTED_SCHEMA_VERSIONS` only after
  reading what changed. A renamed key reads as a missing value, silently.
- Either change needs a test that fails for a build outside the new promise,
  and a commit body that says why.

## Cost

Each call spawns a process, which takes hundreds of milliseconds. A view must
not call the adapter in a loop per task. Fetch a list once, then use `show` for
the one task the user opened. Repeated reads of an unchanged backlog are
meant to cost nothing (UI-2). Go through that layer once it exists rather than
around it.
