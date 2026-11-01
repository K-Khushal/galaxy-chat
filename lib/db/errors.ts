const UNIQUE_VIOLATION = "23505";

/**
 * True for a Postgres unique violation, matched by SQLSTATE rather than by
 * message. Drizzle wraps driver errors, so the code may be on `cause`.
 */
export function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; depth < 5; depth++) {
    if (typeof current !== "object" || current === null) return false;
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
