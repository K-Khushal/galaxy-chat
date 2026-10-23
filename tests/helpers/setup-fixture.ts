import { beforeEach, onTestFinished } from "bun:test";

type ClosableFixture = { close: () => Promise<void> };

/**
 * Keep slow local database bootstrapping on a bounded hook budget while each
 * test body retains Bun's default behavior deadline.
 */
export function setupFixtureBeforeEach<T extends ClosableFixture>(
  create: () => Promise<T>,
  timeout = 15_000,
) {
  let current: T | undefined;
  beforeEach(
    async () => {
      current = undefined;
      const pending = create();
      onTestFinished(() =>
        pending.then(
          (fixture) => fixture.close(),
          () => {},
        ),
      );
      current = await pending;
    },
    { timeout },
  );
  return () => {
    if (!current) throw new Error("fixture_setup_incomplete");
    return current;
  };
}
