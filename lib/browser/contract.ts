import { createHash } from "node:crypto";
import { BrokerError } from "../../services/mcp-egress/src/errors.js";
import { endpoint } from "../../services/mcp-egress/src/profile";

/**
 * Bounded browser-intent CANDIDATE contracts (issue #61, child of #38/#18).
 *
 * This module defines strict candidate data describing what a future browser
 * adapter would be allowed to do, plus a stable content fingerprint over that
 * data. It is a policy diagnostic only: nothing here is approval, network
 * authority, billing proof or provider capability, and no field in this module
 * can enable production execution. Real adapter egress enforcement before
 * requests, authenticated observations, approved durable jobs/funding and
 * actual provider isolation/termination remain pending #38 gates.
 */

export const BROWSER_INTENT_REVISION = "browser-intent-v1" as const;

/** Fixed policy limits. Callers cannot raise them; there is no enabling flag. */
export const BROWSER_LIMITS = {
  allowlistOrigins: 16,
  pathsPerOrigin: 32,
  originChars: 255,
  pathChars: 512,
  urlChars: 2048,
  maxNavigations: 3,
  maxActions: 10,
  totalMs: 60_000,
  extractionBytes: 64 * 1024,
  screenshotBytes: 2 * 1024 * 1024,
  maxTraceEvents: 128,
  // Covers one maximum screenshot (2 MiB + base64 overhead) plus slack;
  // callers cannot push more than this through validation.
  maxTraceBytes: 4 * 1024 * 1024,
  maxEventUrlChars: 2048,
  maxHostnameChars: 253,
  maxResolvedAnswers: 64,
  maxViolations: 32,
} as const;

/** The only actions a browser intent may ever name. No other action exists. */
export const BROWSER_ACTIONS = Object.freeze([
  "navigate",
  "extract-text",
  "screenshot",
] as const);
export type BrowserAction = (typeof BROWSER_ACTIONS)[number];

export type BrowserOriginRule = Readonly<{
  origin: string;
  paths: readonly string[];
}>;

/**
 * Reviewed browser intent candidate. Every field is exact: the initial URL and
 * each allowlist entry are canonical spellings, the action set and limits are
 * fixed literals and the revision is immutable. Parsing never normalizes a
 * caller spelling into an approval — equivalence must come from the allowlist
 * listing both spellings explicitly, which the exactness rules make
 * indistinguishable-by-spelling impossible.
 */
const parsedIntents = new WeakMap<object, string>();

export type BrowserIntent = Readonly<{
  actionRevision: typeof BROWSER_INTENT_REVISION;
  initialUrl: string;
  initialOrigin: string;
  initialPath: string;
  allowlist: readonly BrowserOriginRule[];
  actions: readonly BrowserAction[];
  maxNavigations: typeof BROWSER_LIMITS.maxNavigations;
  maxActions: typeof BROWSER_LIMITS.maxActions;
  totalMs: typeof BROWSER_LIMITS.totalMs;
}>;

/** Closed diagnostic codes. Reports never carry URLs, content or cookies. */
export const BROWSER_VIOLATION_CODES = [
  "trace_unparseable",
  "trace_too_large",
  "trace_event_overflow",
  "event_unrecognized",
  "event_malformed",
  "forbidden_event",
  "missing_session",
  "extra_session",
  "nonmonotonic_time",
  "deadline_exceeded",
  "navigation_exhausted",
  "action_exhausted",
  "url_unparseable",
  "url_not_canonical",
  "destination_not_allowed",
  "hostname_not_allowed",
  "address_evidence_missing",
  "address_evidence_invalid",
  "address_not_public",
  "address_rebinding",
  "method_not_get",
  "extraction_too_large",
  "screenshot_too_large",
  "claimed_bytes_mismatch",
  "payload_unparseable",
  "page_not_navigated",
] as const;
export type BrowserViolationCode = (typeof BROWSER_VIOLATION_CODES)[number];

export type BrowserViolation = Readonly<{
  code: BrowserViolationCode;
  index?: number;
}>;

/**
 * Trace event vocabulary the diagnostic understands. Anything outside this
 * union is either a forbidden event (fixed denial) or unrecognized. Payload
 * strings are measured by the validator; they are never echoed back.
 */
export type BrowserTraceAddress = Readonly<{ address: string; family: number }>;
export type BrowserTraceEvent =
  | Readonly<{ kind: "session"; at: number }>
  | Readonly<{ kind: "navigate"; at: number; url: string; method: "GET" }>
  | Readonly<{ kind: "redirect"; at: number; url: string; method: "GET" }>
  | Readonly<{ kind: "subresource"; at: number; url: string; method: "GET" }>
  | Readonly<{
      kind: "resolved";
      at: number;
      hostname: string;
      answers: readonly BrowserTraceAddress[];
    }>
  | Readonly<{
      kind: "connected";
      at: number;
      hostname: string;
      address: string;
      family: number;
    }>
  | Readonly<{
      kind: "extract-text";
      at: number;
      url: string;
      text: string;
      claimedBytes?: number;
    }>
  | Readonly<{
      kind: "screenshot";
      at: number;
      url: string;
      data: string;
      claimedBytes?: number;
    }>;

/**
 * Named event kinds that are always denied. Popups, tabs, downloads, form or
 * message submission, purchases, credential/cookie/session import, arbitrary
 * script evaluation, extensions, WebSockets and any generic non-GET request
 * have no allowed form in this policy.
 */
export const FORBIDDEN_BROWSER_EVENT_KINDS = [
  "websocket",
  "popup",
  "new-tab",
  "download",
  "form-submit",
  "upload",
  "message",
  "purchase",
  "cookie-import",
  "credential-import",
  "session-import",
  "evaluate",
  "script",
  "extension",
  "request",
] as const;

export type BrowserPolicyCode = "browser_intent_rejected";

/** Fixed-code error. The message is the code; nothing from the input. */
export class BrowserPolicyError extends Error {
  constructor(readonly code: BrowserPolicyCode) {
    super(code);
  }
}

function reject(): never {
  throw new BrowserPolicyError("browser_intent_rejected");
}

function strictKeys(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject();
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    reject();
  const record = value as Record<string, unknown>;
  let count = 0;
  for (const key in record) {
    if (
      !Object.hasOwn(record, key) ||
      ++count > keys.length ||
      !keys.includes(key)
    )
      reject();
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !("value" in descriptor)) reject();
  }
  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !("value" in descriptor)) reject();
    copy[key] = descriptor.value;
  }
  return copy;
}

function arrayEntry(value: readonly unknown[], index: number): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
  if (!descriptor || !("value" in descriptor)) reject();
  return descriptor.value;
}

function boundedString(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max)
    reject();
  return value as string;
}

/**
 * Canonical DNS host origin `https://<host>`: HTTPS, default port only, no
 * credentials, query, fragment or path, no IP literals, no IDNA/punycode, no
 * trailing dot, no internal/special-use suffix and no alternate spelling of
 * the same host. Reuses the MCP egress endpoint exactness checks on the host.
 */
function parseHostOrigin(raw: unknown): string {
  const value = boundedString(raw, BROWSER_LIMITS.originChars);
  if (!value.startsWith("https://")) reject();
  let url: URL;
  try {
    url = endpoint(`${value}/`);
  } catch (error) {
    if (error instanceof BrokerError) reject();
    throw error;
  }
  const canonical = `https://${url.hostname}`;
  if (value !== canonical) reject();
  return canonical;
}

const PATH_PATTERN = /^\/[A-Za-z0-9/_~.-]*$/;

/**
 * Exact reviewed path: bounded ASCII set only. Percent escapes, query forms,
 * fragments, `//`, dot segments and Unicode are rejected outright, so two
 * spellings of the same path cannot both be valid — the allowlist match is
 * exact string equality with nothing to normalize.
 */
function parseReviewedPath(raw: unknown): string {
  const value = boundedString(raw, BROWSER_LIMITS.pathChars);
  if (!PATH_PATTERN.test(value) || value.includes("//")) reject();
  if (value.split("/").some((segment) => segment === "." || segment === ".."))
    reject();
  return value;
}

function parseExactUrl(raw: unknown): { origin: string; path: string } {
  const value = boundedString(raw, BROWSER_LIMITS.urlChars);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    reject();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    reject();
  const origin = parseHostOrigin(`https://${url.hostname}`);
  const path = parseReviewedPath(url.pathname);
  if (value !== `${origin}${path}`) reject();
  return { origin, path };
}

function parseOriginRule(raw: unknown): BrowserOriginRule {
  const record = strictKeys(raw, ["origin", "paths"]);
  const origin = parseHostOrigin(record.origin);
  if (
    !Array.isArray(record.paths) ||
    Object.getPrototypeOf(record.paths) !== Array.prototype ||
    record.paths.length > BROWSER_LIMITS.pathsPerOrigin
  )
    reject();
  const paths: string[] = [];
  for (let i = 0; i < record.paths.length; i++) {
    const path = parseReviewedPath(arrayEntry(record.paths, i));
    if (paths.includes(path)) reject();
    paths.push(path);
  }
  return Object.freeze({ origin, paths: Object.freeze(paths) });
}

function exactActions(value: unknown): readonly BrowserAction[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length !== BROWSER_ACTIONS.length
  )
    reject();
  for (let i = 0; i < BROWSER_ACTIONS.length; i++)
    if (arrayEntry(value, i) !== BROWSER_ACTIONS[i]) reject();
  return Object.freeze([...BROWSER_ACTIONS]);
}

/**
 * Parse an untrusted candidate into an owned, deep-frozen intent. The
 * allowlist may be empty: an explicitly supplied empty list is a valid
 * candidate under which no navigation — including the initial URL — is
 * approved. When non-empty, the initial URL's exact origin and path must be
 * enumerated in the allowlist.
 */
export function parseBrowserIntent(raw: unknown): BrowserIntent {
  const record = strictKeys(raw, [
    "actionRevision",
    "initialUrl",
    "allowlist",
    "actions",
    "maxNavigations",
    "maxActions",
    "totalMs",
  ]);
  if (record.actionRevision !== BROWSER_INTENT_REVISION) reject();
  if (
    record.maxNavigations !== BROWSER_LIMITS.maxNavigations ||
    record.maxActions !== BROWSER_LIMITS.maxActions ||
    record.totalMs !== BROWSER_LIMITS.totalMs
  )
    reject();
  const { origin, path } = parseExactUrl(record.initialUrl);
  if (
    !Array.isArray(record.allowlist) ||
    Object.getPrototypeOf(record.allowlist) !== Array.prototype ||
    record.allowlist.length > BROWSER_LIMITS.allowlistOrigins
  )
    reject();
  const seenOrigins = new Set<string>();
  const allowlist: BrowserOriginRule[] = [];
  for (let i = 0; i < record.allowlist.length; i++) {
    const rule = parseOriginRule(arrayEntry(record.allowlist, i));
    if (seenOrigins.has(rule.origin)) reject();
    seenOrigins.add(rule.origin);
    allowlist.push(rule);
  }
  if (
    allowlist.length > 0 &&
    !allowlist.some(
      (rule) => rule.origin === origin && rule.paths.includes(path),
    )
  )
    reject();
  const intent: BrowserIntent = Object.freeze({
    actionRevision: BROWSER_INTENT_REVISION,
    initialUrl: `${origin}${path}`,
    initialOrigin: origin,
    initialPath: path,
    allowlist: Object.freeze(allowlist),
    actions: exactActions(record.actions),
    maxNavigations: BROWSER_LIMITS.maxNavigations,
    maxActions: BROWSER_LIMITS.maxActions,
    totalMs: BROWSER_LIMITS.totalMs,
  });
  deepFreeze(intent);
  parsedIntents.set(
    intent,
    createHash("sha256").update(canonicalJson(intent)).digest("hex"),
  );
  return intent;
}

/** Exact allowlist membership. GET never widens this and never implies safety. */
export function browserAllowlistAllows(
  intent: BrowserIntent,
  origin: string,
  path: string,
): boolean {
  browserIntentFingerprint(intent);
  return intent.allowlist.some(
    (rule) => rule.origin === origin && rule.paths.includes(path),
  );
}

function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v === "string") return v;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) reject();
      return Object.is(v, -0) ? 0 : v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (
      v &&
      typeof v === "object" &&
      Object.getPrototypeOf(v) === Object.prototype
    )
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, walk(x)]),
      );
    reject();
  };
  return JSON.stringify(walk(value));
}

/** Stable SHA-256 content fingerprint over the normalized intent. */
export function browserIntentFingerprint(intent: BrowserIntent): string {
  const fingerprint = parsedIntents.get(intent);
  if (!fingerprint) reject();
  return fingerprint;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const entry of Object.values(value as object)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}
