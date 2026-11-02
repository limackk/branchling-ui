/**
 * What the terminal can do, and the full-screen lifecycle.
 *
 * Two separate questions, answered separately:
 *
 * - COLOUR is decided per stream: off when NO_COLOR is set to anything
 *   non-empty, when TERM is "dumb", or when that stream is not a TTY. Colour
 *   on stdout says nothing about stderr. NO_COLOR is about colour only: a TTY
 *   with NO_COLOR set still gets the alternate screen, just no SGR codes.
 * - The FULL SCREEN (alternate screen, hidden cursor, raw keys) needs stdin
 *   and stdout to be TTYs and a TERM that is not "dumb". Otherwise the
 *   interface prints the screen once, as plain lines, and exits.
 *
 * Once entered, the terminal is restored on every exit path: quit, Ctrl-C,
 * SIGINT, SIGTERM, SIGHUP, an exception or a rejected promise, and process
 * exit as the last resort. `restore` is idempotent, so two paths firing at
 * once write the sequences once.
 *
 * Streams are passed in, never taken from `process` here, so the tests drive
 * the lifecycle with fake objects and assert on the bytes written.
 */

export const ESC = {
  altScreenOn: "\x1b[?1049h",
  altScreenOff: "\x1b[?1049l",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  home: "\x1b[H",
  clearLineRight: "\x1b[K",
  clearBelow: "\x1b[J",
};

/** True when SGR colour codes may be written to `stream`. */
export function colourEnabled(stream, env = {}) {
  if (typeof env.NO_COLOR === "string" && env.NO_COLOR !== "") return false;
  if (env.TERM === "dumb") return false;
  return Boolean(stream && stream.isTTY);
}

/** True when the interface may take over the screen and read raw keys. */
export function canDriveScreen({ stdin, stdout, env = {} }) {
  if (env.TERM === "dumb") return false;
  return Boolean(stdin && stdin.isTTY && typeof stdin.setRawMode === "function" && stdout && stdout.isTTY);
}

/**
 * The full screen over one stdin/stdout pair.
 *
 * @param {{ stdin: any, stdout: any }} streams
 */
export function createScreen({ stdin, stdout }) {
  let entered = false;
  let restored = false;

  return {
    get active() {
      return entered && !restored;
    },

    /** Alternate screen, hidden cursor, raw keys. */
    enter() {
      // Marked first: if anything below throws, restore() still undoes it.
      entered = true;
      stdout.write(ESC.altScreenOn + ESC.hideCursor);
      stdin.setRawMode(true);
      if (typeof stdin.setEncoding === "function") stdin.setEncoding("utf8");
      if (typeof stdin.resume === "function") stdin.resume();
    },

    /**
     * Repaints the whole screen. The cursor goes home and each line clears
     * what is right of it, so nothing scrolls and no flicker comes from a
     * full clear. The last line is written without a newline, so a screen
     * exactly `rows` high never scrolls the alternate buffer.
     */
    draw(lines) {
      if (!entered || restored) return;
      stdout.write(ESC.home + lines.map(line => line + ESC.clearLineRight).join("\r\n") + ESC.clearBelow);
    },

    /** Leaves the alternate screen, shows the cursor, ends raw mode. Safe to call twice. */
    restore() {
      if (!entered || restored) return;
      restored = true;
      // Each step on its own: a failing one must not stop the others.
      try { stdin.setRawMode(false); } catch { /* the stream may be gone */ }
      try { if (typeof stdin.pause === "function") stdin.pause(); } catch { /* idem */ }
      try { stdout.write(ESC.altScreenOff + ESC.showCursor); } catch { /* idem */ }
    },
  };
}
