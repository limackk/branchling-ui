---
name: backlog-workflow
description: Drive a branchling backlog — markdown task files with YAML frontmatter under a `backlog/` directory — from a coding session. The procedure itself is printed by the tool (`branchling instructions`); this skill is what tells you to go and read it. Use this skill whenever the repository has a `backlog/` (or co-located `tasks/` + `config.yaml`) directory, whenever a task ID like `TL-1234` or `BL-42` appears, and whenever the user says things like "what should I work on", "start TL-1234", "mark this done", "add a task for that", "what's blocked" — even if they never say the word branchling.
---

# Working a branchling backlog

**The procedure is not in this file.** The tool prints it. Run this first and
follow what it gives you:

```bash
branchling instructions overview
```

From a checkout where the package is not installed globally, the same command is
`node scripts/cli.mjs instructions overview`.

`overview` is a switchboard, not a procedure: it says when to act and sends you
to one of three phase guides — writing a task, working one, closing one. Open the
guide that matches what you are about to do. The overview says so itself, and it
means it.

## Why the command and not this file

The guide ships with the tool, so it cannot describe flags the tool no longer
has, and it is rendered with the vocabulary of the backlog in front of you rather
than with the vocabulary of the repository this skill was written in. A copy in a
skill file freezes on the day it was written, and it is then wrong in the way
that is hardest to notice: still specific, still confident, no longer true.

So this file deliberately holds no procedure and no vocabulary. It exists so that
an editor which loads skills by description knows a backlog is here, and knows
which command to run.
