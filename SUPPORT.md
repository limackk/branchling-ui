# Support policy

branchling-ui is an open source, single-maintainer project. Help is
best-effort, and opening an issue or pull request does not create a guaranteed
response or resolution time.

## Before opening an issue

Decide which side of the CLI contract the problem is on:

- **The interface shows or does something wrong** with data that
  `branchling … --json` reports correctly: that is an issue
  [here](https://github.com/limackk/branchling-ui/issues/new?template=bug_report.yml).
- **branchling itself** reports it wrongly, or cannot do what the interface
  needs: that is an issue
  [upstream](https://github.com/limackk/branchling/issues). This package
  deliberately does not work around a missing capability.

Include `branchling --version`, `node --version` and your operating system.
Those three settle most reports before anybody has to guess.

Do not report an undisclosed vulnerability in an issue. Follow
[SECURITY.md](SECURITY.md).

## Contributing a fix

Read [CONTRIBUTING.md](CONTRIBUTING.md). A technically sound proposal can still
be declined if it breaks the one rule there or if its maintenance cost is not
sustainable.
