import { isIP } from "node:net";
import { BrokerError } from "../../services/mcp-egress/src/errors.js";
import { publicAddress } from "../../services/mcp-egress/src/ip-policy";
import {
  BROWSER_ACTIONS,
  BROWSER_INTENT_REVISION,
  BROWSER_LIMITS,
  type BrowserIntent,
  type BrowserTraceAddress,
  type BrowserViolation,
  type BrowserViolationCode,
  browserAllowlistAllows,
  browserIntentFingerprint,
  FORBIDDEN_BROWSER_EVENT_KINDS,
} from "./contract";

/**
 * Deterministic bounded validation of SYNTHETIC browser/network traces against
 * a reviewed intent candidate (issue #61, child of #38/#18).
 *
 * This is a candidate/fixture diagnostic. It confers no executable capability,
 * admission token, resource-stop evidence or settlement. It never performs
 * fetch, DNS, browser automation or any host payload execution: it only walks
 * a caller-supplied event list under fixed bounds. A finite caller-supplied
 * trace cannot prove that unreported browser traffic did not occur — the
 * result is classified synthetic-evidence-only and carries an explicit
 * not-observable marker for that reason.
 */

export const BROWSER_DIAGNOSTIC_CLASSIFICATION =
  "synthetic-evidence-only" as const;

export type BrowserTraceDiagnostic = Readonly<{
  classification: typeof BROWSER_DIAGNOSTIC_CLASSIFICATION;
  evidence: "caller-supplied";
  authority: "none";
  unreportedTraffic: "not-observable";
  accepted: boolean;
  actionRevision: typeof BROWSER_INTENT_REVISION;
  intentFingerprint: string;
  counts: Readonly<{
    events: number;
    navigations: number;
    redirects: number;
    subresources: number;
    extractions: number;
    screenshots: number;
    actions: number;
    extractionBytes: number;
    screenshotBytes: number;
    distinctHosts: number;
  }>;
  violations: readonly BrowserViolation[];
}>;

const FORBIDDEN_KINDS: ReadonlySet<string> = new Set(
  FORBIDDEN_BROWSER_EVENT_KINDS,
);
const KNOWN_KINDS: ReadonlySet<string> = new Set([
  "session",
  "navigate",
  "redirect",
  "subresource",
  "resolved",
  "connected",
  ...BROWSER_ACTIONS,
]);
const HOSTNAME_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_SCREENSHOT_B64_CHARS =
  4 * Math.ceil(BROWSER_LIMITS.screenshotBytes / 3) + 4;

type Violations = {
  list: BrowserViolation[];
  add(code: BrowserViolationCode, index?: number): void;
};

function createViolations(): Violations {
  const list: BrowserViolation[] = [];
  return {
    list,
    add(code, index) {
      if (list.length < BROWSER_LIMITS.maxViolations)
        list.push(index === undefined ? { code } : { code, index });
    },
  };
}

interface HostEvidence {
  answers: Set<string>;
  connected: boolean;
}

/**
 * Validate a trace URL exactly: canonical `https://host/path` spelling, no
 * credentials/query/fragment/port/escapes/IP-literal/internal host, and exact
 * allowlist membership. Returns the hostname when valid, else undefined.
 */
function checkTraceUrl(
  raw: unknown,
  intent: BrowserIntent,
  index: number,
  violations: Violations,
): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) {
    violations.add("url_unparseable", index);
    return undefined;
  }
  if (raw.length > BROWSER_LIMITS.maxEventUrlChars) {
    violations.add("url_not_canonical", index);
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    violations.add("url_unparseable", index);
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    isIP(url.hostname) !== 0 ||
    (url.hostname.startsWith("[") && url.hostname.endsWith("]"))
  ) {
    violations.add("url_not_canonical", index);
    return undefined;
  }
  const host = url.hostname;
  if (
    host.length > BROWSER_LIMITS.maxHostnameChars ||
    host.endsWith(".") ||
    host.split(".").some((label) => label.startsWith("xn--")) ||
    /\.(localhost|local|internal|invalid|test)$/.test(host) ||
    !HOSTNAME_PATTERN.test(host)
  ) {
    violations.add("hostname_not_allowed", index);
    return undefined;
  }
  const path = url.pathname;
  if (
    !/^\/[A-Za-z0-9/_~.-]*$/.test(path) ||
    path.includes("//") ||
    path.split("/").some((segment) => segment === "." || segment === "..") ||
    raw !== `${url.origin}${path}`
  ) {
    violations.add("url_not_canonical", index);
    return undefined;
  }
  if (!browserAllowlistAllows(intent, `https://${host}`, path)) {
    violations.add("destination_not_allowed", index);
    return undefined;
  }
  return host;
}

function checkHostname(
  raw: unknown,
  index: number,
  violations: Violations,
): string | undefined {
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    raw.length > BROWSER_LIMITS.maxHostnameChars ||
    isIP(raw) !== 0 ||
    (raw.startsWith("[") && raw.endsWith("]")) ||
    raw.endsWith(".") ||
    raw.split(".").some((label) => label.startsWith("xn--")) ||
    /\.(localhost|local|internal|invalid|test)$/.test(raw) ||
    !HOSTNAME_PATTERN.test(raw)
  ) {
    violations.add("hostname_not_allowed", index);
    return undefined;
  }
  return raw;
}

function publicAnswer(
  value: unknown,
  index: number,
  violations: Violations,
): BrowserTraceAddress | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as BrowserTraceAddress).address !== "string" ||
    typeof (value as BrowserTraceAddress).family !== "number"
  ) {
    violations.add("address_evidence_invalid", index);
    return undefined;
  }
  const candidate = value as BrowserTraceAddress;
  try {
    return publicAddress({
      address: candidate.address,
      family: candidate.family,
    });
  } catch (error) {
    if (error instanceof BrokerError) {
      violations.add("address_not_public", index);
      return undefined;
    }
    throw error;
  }
}

function isSafeTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * Evaluate a raw trace against a parsed intent. The trace is bounded (event
 * count, URL/string lengths, total UTF-8 bytes) before any per-event work.
 * Hostile input produces fixed violation codes; no raw URL, payload text,
 * screenshot bytes, cookie or error string is ever echoed into the result.
 */
export function evaluateBrowserTrace(
  intent: BrowserIntent,
  raw: unknown,
): BrowserTraceDiagnostic {
  const violations = createViolations();
  const counts = {
    events: 0,
    navigations: 0,
    redirects: 0,
    subresources: 0,
    extractions: 0,
    screenshots: 0,
    actions: 0,
    extractionBytes: 0,
    screenshotBytes: 0,
    distinctHosts: 0,
  };

  let events: readonly unknown[];
  let wholesaleRejected = false;
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    !Array.isArray((raw as { events?: unknown }).events)
  ) {
    violations.add("trace_unparseable");
    wholesaleRejected = true;
    events = [];
  } else {
    events = (raw as { events: readonly unknown[] }).events;
    if (events.length > BROWSER_LIMITS.maxTraceEvents) {
      // Bound before any iteration or serialization of the events.
      violations.add("trace_event_overflow");
      wholesaleRejected = true;
      events = [];
    } else {
      let totalBytes: number | null = null;
      try {
        totalBytes = Buffer.byteLength(JSON.stringify(raw) ?? "", "utf8");
      } catch {
        totalBytes = null;
      }
      if (totalBytes === null) {
        violations.add("trace_unparseable");
        wholesaleRejected = true;
        events = [];
      } else if (totalBytes > BROWSER_LIMITS.maxTraceBytes) {
        violations.add("trace_too_large");
        wholesaleRejected = true;
        events = [];
      }
    }
  }

  let lastAt: number | null = null;
  let deadline: number | null = null;
  let sessions = 0;
  let navigations = 0;
  const hosts = new Map<string, HostEvidence>();

  for (let index = 0; index < events.length; index++) {
    counts.events = index + 1;
    const event = events[index];
    if (
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      typeof (event as { kind?: unknown }).kind !== "string"
    ) {
      violations.add("event_unrecognized", index);
      continue;
    }
    const kind = (event as { kind: string }).kind;
    const record = event as Record<string, unknown>;

    if (FORBIDDEN_KINDS.has(kind)) {
      violations.add("forbidden_event", index);
      continue;
    }
    if (!KNOWN_KINDS.has(kind)) {
      violations.add("event_unrecognized", index);
      continue;
    }
    if (!isSafeTime(record.at)) {
      violations.add("event_malformed", index);
      continue;
    }
    if (lastAt !== null && record.at < lastAt) {
      violations.add("nonmonotonic_time", index);
      continue;
    }
    if (deadline !== null && record.at > deadline) {
      // Monotonic time can never renew the original session deadline.
      violations.add("deadline_exceeded", index);
      continue;
    }
    lastAt = record.at;

    if (kind === "session") {
      sessions++;
      if (sessions > 1) {
        violations.add("extra_session", index);
        continue;
      }
      deadline = record.at + BROWSER_LIMITS.totalMs;
      continue;
    }

    if (kind === "resolved") {
      const hostname = checkHostname(record.hostname, index, violations);
      if (hostname === undefined) continue;
      if (
        !Array.isArray(record.answers) ||
        record.answers.length === 0 ||
        record.answers.length > BROWSER_LIMITS.maxResolvedAnswers
      ) {
        violations.add("address_evidence_invalid", index);
        continue;
      }
      const answers = new Set<string>();
      let valid = true;
      for (const answer of record.answers) {
        const checked = publicAnswer(answer, index, violations);
        if (!checked) {
          valid = false;
          break;
        }
        answers.add(checked.address);
      }
      if (!valid) continue;
      const existing = hosts.get(hostname);
      if (existing) {
        // A second resolution must not change the destination's answer set.
        const same =
          existing.answers.size === answers.size &&
          [...answers].every((address) => existing.answers.has(address));
        if (!same) violations.add("address_rebinding", index);
        continue;
      }
      hosts.set(hostname, { answers, connected: false });
      counts.distinctHosts = hosts.size;
      continue;
    }

    if (kind === "connected") {
      const hostname = checkHostname(record.hostname, index, violations);
      if (hostname === undefined) continue;
      const checked = publicAnswer(record, index, violations);
      if (!checked) continue;
      const evidence = hosts.get(hostname);
      if (!evidence) {
        violations.add("address_evidence_missing", index);
        continue;
      }
      if (!evidence.answers.has(checked.address)) {
        violations.add("address_rebinding", index);
        continue;
      }
      evidence.connected = true;
      continue;
    }

    if (kind === "navigate" || kind === "redirect" || kind === "subresource") {
      if (record.method !== "GET") {
        violations.add("method_not_get", index);
        continue;
      }
      if (kind === "navigate") {
        navigations++;
        counts.navigations = navigations;
        if (navigations > BROWSER_LIMITS.maxNavigations) {
          violations.add("navigation_exhausted", index);
        }
      } else if (kind === "redirect") {
        counts.redirects++;
      } else {
        counts.subresources++;
      }
      // Only navigations and payload actions are user-level actions;
      // redirects and subresources are observational events.
      if (kind === "navigate") {
        counts.actions++;
        if (counts.actions > BROWSER_LIMITS.maxActions) {
          violations.add("action_exhausted", index);
        }
      }
      const host = checkTraceUrl(record.url, intent, index, violations);
      if (host !== undefined) {
        if (kind === "navigate" && navigations === 1) {
          // The first navigation must be the intent's exact initial URL.
          const path = new URL(record.url as string).pathname;
          if (
            `https://${host}${path}` !==
            `${intent.initialOrigin}${intent.initialPath}`
          )
            violations.add("destination_not_allowed", index);
        }
        // Every network destination needs resolved + connected evidence.
        if (!hosts.get(host)?.connected)
          violations.add("address_evidence_missing", index);
      }
      continue;
    }

    if (kind === "extract-text" || kind === "screenshot") {
      counts.actions++;
      if (counts.actions > BROWSER_LIMITS.maxActions) {
        violations.add("action_exhausted", index);
      }
      checkTraceUrl(record.url, intent, index, violations);
      if (kind === "extract-text") counts.extractions++;
      else counts.screenshots++;
      const claimed = record.claimedBytes;
      if (claimed !== undefined && !isSafeTime(claimed)) {
        violations.add("event_malformed", index);
        continue;
      }
      if (kind === "extract-text") {
        const text = record.text;
        if (typeof text !== "string") {
          violations.add("event_malformed", index);
          continue;
        }
        // UTF-8 bytes per UTF-16 code unit never exceed 3; skip measuring
        // only when the bound is already exceeded.
        if (text.length > BROWSER_LIMITS.extractionBytes * 3) {
          violations.add("extraction_too_large", index);
          continue;
        }
        const bytes = Buffer.byteLength(text, "utf8");
        if (bytes > BROWSER_LIMITS.extractionBytes) {
          violations.add("extraction_too_large", index);
          continue;
        }
        if (claimed !== undefined && claimed !== bytes) {
          violations.add("claimed_bytes_mismatch", index);
          continue;
        }
        counts.extractionBytes += bytes;
        continue;
      }
      const data = record.data;
      if (typeof data !== "string") {
        violations.add("event_malformed", index);
        continue;
      }
      if (data.length > MAX_SCREENSHOT_B64_CHARS) {
        violations.add("screenshot_too_large", index);
        continue;
      }
      if (data.length % 4 !== 0 || !BASE64_PATTERN.test(data)) {
        violations.add("payload_unparseable", index);
        continue;
      }
      const bytes = Buffer.from(data, "base64").length;
      if (bytes > BROWSER_LIMITS.screenshotBytes) {
        violations.add("screenshot_too_large", index);
        continue;
      }
      if (claimed !== undefined && claimed !== bytes) {
        violations.add("claimed_bytes_mismatch", index);
        continue;
      }
      counts.screenshotBytes += bytes;
      continue;
    }

    // Exhaustive over the known vocabulary; unreachable.
    violations.add("event_unrecognized", index);
  }

  if (sessions === 0 && !wholesaleRejected) {
    violations.add("missing_session");
  }

  return Object.freeze({
    classification: BROWSER_DIAGNOSTIC_CLASSIFICATION,
    evidence: "caller-supplied",
    authority: "none",
    unreportedTraffic: "not-observable",
    accepted: violations.list.length === 0 && sessions === 1,
    actionRevision: BROWSER_INTENT_REVISION,
    intentFingerprint: browserIntentFingerprint(intent),
    counts: Object.freeze({ ...counts }),
    violations: Object.freeze([...violations.list]),
  });
}
