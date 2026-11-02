---
name: ui-terminal
description: Build or change a screen of the branchling-ui terminal interface (the TUI). Covers bin/branchling-ui-tui.mjs, src/tui/ (terminal.mjs, render.mjs, text.mjs, screens/, app.mjs), rendering the shared view model as lines of text, the keyboard model and the key map, NO_COLOR, TERM=dumb and TTY checks per stream, the 16 ANSI colours and colour roles, the alternate screen and restoring the terminal on every exit path, resize, Windows terminals, and the tests in test/tui.test.mjs. Use this skill whenever work touches the terminal interface, a key binding, ANSI output or terminal colour, and for requests like "show the plan in the terminal", "add a key for X", "the TUI should show Y", "make it work in Windows Terminal", "the terminal is broken after a crash" — even if the word TUI never comes up.
---

# How a screen is built in the terminal interface

The decision and its reasons are in `docs/architecture.md`, section "The
terminal interface (TUI, UI-16)"; read it before changing any of them. In
short: no dependency, only Node's raw mode and ANSI escape sequences. Never
add a runtime dependency (CI refuses one); Ink and blessed-like libraries
were compared and rejected.

## The rules it shares with the web interface

- **The adapter is the only door.** The TUI gets data by calling adapter
  methods (`adapter.stats()`), never by spawning anything or reading a
  backlog file. A missing capability is a `ui-adapter` matter, then an
  upstream task.
- **Nothing writes a task file.** A future action key runs a branchling
  command through an adapter method, nothing else.
- **It renders the shared view model.** The screen is built from what
  `src/view-model/` returns: counts, labels, sentences (`STATS_TEXT`), order
  and state. If the TUI needs something the model lacks, add it to the view
  model (pure, no ANSI, no `node:` import) with a test in
  `test/view-model.test.mjs`, never compute it in `src/tui/`. The `ui-web`
  skill describes the model.

## The three pieces

1. **`src/tui/render.mjs`**: a pure function from a model, a width, a height,
   a colour flag and the key list to an array of lines. No I/O, no
   `process`. It decides layout only. Every line fits the width in visible
   columns (truncated with an ellipsis); a long root path keeps its end.
2. **`src/tui/terminal.mjs`**: `colourEnabled(stream, env)`,
   `canDriveScreen({ stdin, stdout, env })` and `createScreen`, which
   enters, draws and restores the full screen.
3. **`src/tui/app.mjs`**: `runTui({ adapter, stdin, stdout, stderr, proc,
   env })`, the loop. Every stream and the process-like event source are
   parameters, so tests pass fakes.

A screen is one module in `src/tui/screens/` and one line in
`src/tui/screens/index.mjs`: its id, key, title, loading and stale sentences
(from the view model's `*_TEXT`), `read(adapter)` making the same adapter calls
the web page's routes make, `model(input, freshness, now)` calling the view
model, and `body(model, width)` returning lines for a ready or empty model.
Loading, error, refusal, rejected and stale are drawn by `render.mjs` for every
screen alike; the loop reads through one cache scope per refresh and keeps
each screen's last answer to show stale. A screen never gets its own
lifecycle code. The line helpers (`seg`, `fit`, `wrap`, `para`, `taskLine`,
`commandLines`) are in `src/tui/text.mjs`. A body taller than the terminal
scrolls (`j`/`k`) and the row above the key map says which lines are shown.

## Colour

- Off when `NO_COLOR` is non-empty, when `TERM=dumb`, or when that stream is
  not a TTY. Check each stream on its own: colour on stdout says nothing
  about stderr.
- `NO_COLOR` turns off colour, not the full screen: a terminal with
  `NO_COLOR` still gets the alternate screen and the hidden cursor, and no
  SGR code at all.
- Only the 16 ANSI colours (SGR 30 to 37 and 90 to 97), bold and dim. Never
  256-colour or truecolour codes: the user's theme decides the palette.
- Statuses and priorities are styled through `ROLE_STYLE[row.role]`, never
  by status or priority name. Every role is `neutral` (no styling) until
  UI-18 brings the vocabulary from config.yaml through the CLI.
- Colour is never the only signal: every value keeps its label, every state
  its sentence.
- Text from the backlog goes through `clean()`: control characters, ESC
  included, become `?` so a status key cannot move the cursor or recolour the
  terminal.

## The full-screen lifecycle

- The full screen needs stdin and stdout to be TTYs and `TERM` not `dumb`.
  Otherwise print the screen once (no key map), exit 0 for data and 1 for an
  error or a refusal, and never touch raw mode.
- Enter: alternate screen (`ESC[?1049h`), hidden cursor (`ESC[?25l`), raw
  mode on stdin.
- Restore on EVERY exit path: `q`, Ctrl-C (a key in raw mode, not a signal),
  SIGINT, SIGTERM, SIGHUP, `uncaughtException`, `unhandledRejection`, and the
  `exit` event as the last resort. Leave the alternate screen, show the
  cursor, end raw mode. `restore()` is idempotent; keep it that way.
- Every handler runs through `guard()`, so an exception in a key handler, a
  redraw or an async read ends the run with the terminal restored and the
  stack on stderr.
- Redraw on stdout's `resize` event. Do not use SIGWINCH: Windows has none,
  and Node emits `resize` there too.
- Draw by moving the cursor home and clearing to the right of each line;
  never write a newline after the last row, so the screen does not scroll.

## The keyboard model

Single keys, no modifiers, listed in `KEYS` in `src/tui/render.mjs` and shown
on the last row (`1 stats … q quit`), each with the characters that press it
(`inputs`). A key that is not in `KEYS` does not exist. Escape sequences (arrows, function keys) are ignored until a screen
needs them. A key that writes must ask for confirmation on screen first and
then call an adapter method.

## States

Loading, empty, error, refusal and stale come from `src/view-model/`
(`loadingState`, `fromAdapterError`, `statsModel(..., { stale })`). A refusal
shows its title, detail and reason code, and never looks like an empty
screen. On refresh the last data stays on screen marked stale until the new
answer arrives.

## Windows

Windows Terminal and the Windows 10 (1809+) console host understand the same
VT sequences. Node gives raw mode and `resize` there. Use `\r\n` between
lines. The adapter already starts the `.cmd` shim safely; the TUI never
spawns anything itself.

## Tests

`test/tui.test.mjs`, `node:test`, no dependency:

- render at 80 columns and assert no line is wider, measured with escape
  sequences stripped;
- with colour off, assert the output has no `\x1b`; pair it with the same
  model rendered with colour on as the positive control;
- drive `runTui` with fake stdin, stdout, stderr and process objects, throw
  from a handler or emit a signal, and assert the bytes end with
  `ESC[?1049l ESC[?25h`, written once, and that raw mode is off;
- at least one test against the REAL executable over a fixture backlog built
  in a temporary directory with branchling's own commands through `run`.
  Never assert values from this repository's backlog.

```bash
node --test test/tui.test.mjs
npm run tui -- --dir path/to/backlog
```
