export type ErrorCode =
  | "configuration"
  | "invalid_request"
  | "authentication"
  | "replay"
  | "unavailable"
  | "destination"
  | "tls"
  | "timeout"
  | "cancelled"
  | "response"
  | "limit"
  | "busy";
export class BrokerError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}
export function fail(code: ErrorCode): never {
  throw new BrokerError(code);
}
export function errorCode(error: unknown): ErrorCode {
  return error instanceof BrokerError ? error.code : "unavailable";
}
export function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid_request");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key)))
    fail("invalid_request");
  return record;
}
export function text(value: unknown, max = 128): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max)
    fail("invalid_request");
  return value;
}
export function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    fail("invalid_request");
  return value;
}
