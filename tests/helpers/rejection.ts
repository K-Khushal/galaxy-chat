import { expect } from "bun:test";
/** Native await keeps the event loop running for the same-process PG socket.
 * Bun's async rejection matchers delay socket progress while waiting. */
export async function rejectionOf(
  operation: PromiseLike<unknown>,
): Promise<unknown> {
  let rejected = false;
  let reason: unknown;
  try {
    await operation;
  } catch (error) {
    rejected = true;
    reason = error;
  }
  expect(rejected).toBe(true);
  return reason;
}
