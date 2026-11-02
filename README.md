# branchling-ui

A visual interface for [branchling](https://github.com/limackk/branchling)
backlogs. Early development; nothing is published yet.

It talks to branchling only through its public CLI contract (`--json` reading
commands and callable writing commands), so any backlog that branchling can
read, this interface can show, and every change it makes is validated,
attributed and recorded by branchling itself.

Requirements: Node.js 18 or later and `branchling` 0.2.x on PATH (or
`BRANCHLING_BIN` pointing at it).

```bash
npm test
```

License: MIT.
