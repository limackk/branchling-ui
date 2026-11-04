/**
 * A file-wide fixture that the first test to RUN builds, and that is torn down
 * only when it was built (UI-41).
 *
 * WHY NOT `before` AND `after`. Under `--test-name-pattern`, a file in which no
 * test matches still reaches its hooks, and node:test does not pair them: a
 * `before` that starts a server can run while the `after` that closes it does
 * not, so the process keeps a listening socket and never exits. Measured with
 * Node 24 on 2026-11-04: `node --test --test-name-pattern=<no match>
 * test/server.test.mjs` was still running after 40 seconds, and a closing
 * contract that filters by name hung for an hour. Building the fixture inside
 * the first test that runs means a file with no matching test builds nothing,
 * and there is nothing left to leak.
 *
 * Usage: `const { test } = lazyFixture(setup, teardown)`, then write the file's
 * tests with that `test` exactly as with node:test's. The fixture is built at
 * most once; a test that does not need it pays for it once, as it did under
 * `before`.
 */
import { test as nodeTest, after } from "node:test";

export function lazyFixture(setup, teardown) {
  let ready = null;
  const ensure = () => (ready ??= setup());

  after(async () => {
    if (!ready) return;
    // A failed setup has already failed its test; tear down what exists.
    try { await ready; } catch { /* reported by the test that awaited it */ }
    await teardown();
  });

  const test = (name, ...rest) => {
    const fn = rest.pop();
    return nodeTest(name, ...rest, async t => {
      await ensure();
      return fn(t);
    });
  };

  return { test, ensure };
}
