# Contributing

Pull requests are welcome. The code is MIT, and your contribution goes out
under MIT. Report an undisclosed vulnerability through the private route in
[SECURITY.md](SECURITY.md), never in a public issue. What fits the project and
what a report should carry is in [SUPPORT.md](SUPPORT.md).

---

## Running it

Node 18 or newer.

```bash
git clone https://github.com/limackk/branchling-ui.git
cd branchling-ui
npm ci       # installs the pinned branchling build, nothing else
npm test     # the contract tests
npx branchling check   # the backlog guards
```

`branchling` is a **devDependency**, not something you install globally first.
`npm test` puts `node_modules/.bin` ahead of your PATH, so the tests run
against the build `package-lock.json` names, the same one CI runs: the
registry release `branchling` 0.3.0, the first with every command the adapter
calls (UI-14). To test against another build (an upstream checkout, say),
point `BRANCHLING_BIN` at its executable.

CI runs the tests and the guards on Node 18, 20 and 22, on Linux and macOS,
and on Windows with Node 22.

---

## The one rule

This package is a **consumer** of branchling. It reaches it only through the
CLI contract, through `src/adapter.mjs`. It never imports branchling's
`scripts/` and never writes a task file itself. [AGENTS.md](AGENTS.md) spells
the rule out. It is written for an agent and is just as true for a person.

When the interface needs something the CLI cannot do yet, the change belongs
**upstream**: open an issue in
[limackk/branchling](https://github.com/limackk/branchling/issues) and track
the dependency in this repository's backlog. A workaround here, such as
reading a backlog file directly, is declined in review however small it is.

---

## The backlog

`backlog/` is this repository's own backlog, kept in branchling's format. An
issue that turns into work gets a task file there, and that file is how anyone
can pick the work up.

```bash
npx branchling instructions overview          # how to work this backlog
npx branchling query --status pending --priority P0,P1
npx branchling take UI-<n> --actor local:<your-nick>
npx branchling done UI-<n>                    # runs the task's verification
```

Use your own `local:<nick>` actor. `local:me` in `config.yaml` is only the
default.

---

## Working with an agent

The repository is set up for Claude Code and Codex alike:

| File | Read by | What it gives the agent |
|---|---|---|
| `AGENTS.md` | Codex, Claude (via `CLAUDE.md`), most other agents | the project's rules |
| `.agents/skills/` | Codex; Claude through the `.claude/skills/` symlink | the skill that points at `branchling instructions` |
| `.claude/settings.json` | Claude Code | a view-rebuild hook and read-only permissions |
| `.codex/hooks.json` | Codex | the same hook |
| `.mcp.json` | Claude Code and other MCP clients | the `branchling mcp` server |

Codex registers MCP servers through its own configuration:

```bash
codex mcp add branchling -- npx --no-install branchling mcp
```

Personal settings go in `.claude/settings.local.json` or `CLAUDE.local.md`.
Both are ignored by git. Do not widen the shared permission list for your own
convenience: it applies to everyone who clones the repository.

On Windows, git must check out the `.claude/skills` symlink as a link
(`git config core.symlinks true` with Developer Mode enabled). Otherwise Claude
Code sees a text file instead of the skill.

---

## What a change has to carry

1. **A test that could fail.** Contract tests run against the real executable
   over a fixture backlog in a temporary directory. They never assert values
   from this repository's own backlog.
2. **`npm test` and `npx branchling check` passing.**
3. **One task, one commit.** The title starts with the task id and says what is
   now true, in 72 characters or fewer, with no trailing full stop. The body says
   why, including what you decided against.
4. **English everywhere**, including commits, branch names
   (`ui-<number>-<short-english-slug>`) and the backlog.

Moving `SUPPORTED_SCHEMA_VERSIONS` or `SUPPORTED_RANGE` in the adapter changes
the compatibility promise. It needs tests and a reason in the commit body.
