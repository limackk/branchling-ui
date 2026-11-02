---
id: UI-25
title: "Every web view is drawn with the design system"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: done
owner: agent:loop-a
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: suite
    bash: "npm test"
  - id: contrast
    bash: "node .agents/skills/ui-verify/contrast.mjs"
  - id: design-merged
    bash: "test -f docs/design/tokens.css && test -f docs/design/components.css && git merge-base --is-ancestor refs/heads/ui-design-system HEAD"
  - id: screens-checked
    manual: "Screenshots of the stats, release, plan and decisions views in light and dark at 375 px and desktop width were looked at, and every state renders on the system."
---

## Goal

Every screen of the web interface — stats, release, plan and decisions — is drawn with the Ledger design system from docs/design/, in light and dark, so the page looks like one product and every later view starts from the same tokens and components.

## Context

The design system and mockups were built in a separate session on 2026-11-02 while the supervised loops were adding views. That work stood uncommitted in the main checkout and was moved, byte for byte, to the branch `ui-design-system` (one commit on top of 976e8f1): docs/design/ (tokens.css, tokens.json, components.css, icons.svg, contrast-pairs.json, design-system.html, mockups/, README.md), src/web/styles.css rebuilt as tokens.css + components.css + rules for the stats and release markup, small edits to src/web/app.mjs, index.html, release.mjs, src/view-model/roles.mjs, the ui-web skill, and a .claude/launch.json that serves docs/design on port 4390. Since then main gained the plan view (UI-3), the decisions view (UI-5) and their styles, so a merge conflicts in src/web/index.html and src/web/styles.css, and the two new views are not on the system yet. docs/design/README.md ('In the app') says styles.css is tokens.css and components.css copied, then the per-view rules; change a token in docs/design first, then copy. Status and priority colours stay neutral until UI-18. The app shell with a sidebar and icons.svg come with the first view that needs them; with four views the page may now need navigation between them — decide that against the mockups and the ui-web skill, and record it. The contrast checker in .agents/skills/ui-verify/contrast.mjs reads the hex tokens of :root and the dark block from styles.css; if the token format changed it must still find and check every pair.

## Steps

1. Merge `refs/heads/ui-design-system` into the task branch and resolve the conflicts in src/web/index.html and src/web/styles.css, keeping every view's markup and behaviour from main
2. Put the plan and decisions views on the system's tokens and components, using the mockups in docs/design/mockups/ (plan.html, decisions.html) as the target, with no new hard-coded colours
3. Decide whether the page now needs the app shell or another way to move between the four views, implement it if so, and record the decision in docs/architecture.md
4. Make the contrast checker cover the merged styles.css and every pair the views use, in light and dark
5. Do the ui-verify pass on all four views: light and dark, phone and desktop width, every state, keyboard only at 200% zoom
6. Keep .claude/launch.json only if it still serves a purpose, and update docs/design/README.md 'In the app' to what is now true

## Acceptance criteria

- [x] The whole suite passes against the pinned branchling with the design system merged. [proof: suite]
- [x] Every token pair the page uses meets WCAG 2.2 AA contrast in light and dark. [proof: contrast]
- [x] The design-system branch is merged and its source files are in the tree. [proof: design-merged]
- [x] All four views were checked on screen in both schemes and both widths. [proof: screens-checked]
