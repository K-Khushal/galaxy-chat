import { expect, test } from "bun:test";
import { reportError, sdk, sdkReady } from "../lib/client-errors";

test("errors reported before the SDK loads are held, then sent with their tags", () => {
  const sent: unknown[][] = [];
  const first = new Error("early");
  reportError(first, { errorId: "abc" });
  reportError("second");
  expect(sdk()).toBeUndefined();
  sdkReady({
    captureException: (...args: unknown[]) => sent.push(args),
  } as never);
  expect(sent).toEqual([
    [first, { tags: { errorId: "abc" } }],
    ["second", undefined],
  ]);
  // Once loaded, errors go straight through.
  reportError("third");
  expect(sent.at(-1)).toEqual(["third", undefined]);
});
