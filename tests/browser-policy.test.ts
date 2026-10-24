import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  BROWSER_ACTIONS,
  BROWSER_INTENT_REVISION,
  BROWSER_LIMITS,
  BROWSER_VIOLATION_CODES,
  type BrowserIntent,
  BrowserPolicyError,
  browserIntentFingerprint,
  parseBrowserIntent,
} from "../lib/browser/contract";
import {
  type BrowserTraceDiagnostic,
  evaluateBrowserTrace,
} from "../lib/browser/policy";

// RFC 2606 reserved documentation hosts only. No real site is approved here
// and none ships as a default: the library default allowlist is empty.
const HOST = "https://example.com";
const INITIAL_PATH = "/docs/page";
const INITIAL_URL = `${HOST}${INITIAL_PATH}`;
const PUBLIC_V4 = { address: "93.184.216.34", family: 4 };

function intentInput(overrides: Record<string, unknown> = {}) {
  return {
    actionRevision: BROWSER_INTENT_REVISION,
    initialUrl: INITIAL_URL,
    allowlist: [
      {
        origin: HOST,
        paths: [
          INITIAL_PATH,
          "/docs/style.css",
          "/p1",
          "/p2",
          "/p3",
          "/p4",
          "/p5",
          "/p6",
          "/p7",
          "/p8",
          "/p9",
        ],
      },
    ],
    actions: [...BROWSER_ACTIONS],
    maxNavigations: BROWSER_LIMITS.maxNavigations,
    maxActions: BROWSER_LIMITS.maxActions,
    totalMs: BROWSER_LIMITS.totalMs,
    ...overrides,
  };
}

const INTENT: BrowserIntent = parseBrowserIntent(intentInput());

function evidenceEvents(at: number, host = "example.com"): unknown[] {
  return [
    { kind: "resolved", at, hostname: host, answers: [PUBLIC_V4] },
    {
      kind: "connected",
      at: at + 10,
      hostname: host,
      address: PUBLIC_V4.address,
      family: 4,
    },
  ];
}

function validTrace(): { events: unknown[] } {
  return {
    events: [
      { kind: "session", at: 1000 },
      ...evidenceEvents(1100),
      { kind: "navigate", at: 1300, url: INITIAL_URL, method: "GET" },
      {
        kind: "subresource",
        at: 1400,
        url: `${HOST}/docs/style.css`,
        method: "GET",
      },
      {
        kind: "extract-text",
        at: 1500,
        url: INITIAL_URL,
        text: "synthetic read-only page text",
      },
      {
        kind: "screenshot",
        at: 1600,
        url: INITIAL_URL,
        data: Buffer.from("synthetic-frame").toString("base64"),
      },
    ],
  };
}

function evaluate(
  trace: readonly unknown[] | { events: readonly unknown[] },
  intent: BrowserIntent = INTENT,
) {
  return evaluateBrowserTrace(
    intent,
    Array.isArray(trace) ? { events: [...trace] } : trace,
  );
}

function codesOf(diagnostic: BrowserTraceDiagnostic): string[] {
  return diagnostic.violations.map((violation) => violation.code);
}

test("valid synthetic read-only fixture passes with explicit synthetic-only labeling", () => {
  const diagnostic = evaluate(validTrace());
  expect(diagnostic.accepted).toBe(true);
  expect(diagnostic.classification).toBe("synthetic-evidence-only");
  expect(diagnostic.evidence).toBe("caller-supplied");
  expect(diagnostic.authority).toBe("none");
  expect(diagnostic.unreportedTraffic).toBe("not-observable");
  expect(diagnostic.actionRevision).toBe(BROWSER_INTENT_REVISION);
  expect(diagnostic.violations).toEqual([]);
  expect(diagnostic.counts).toEqual({
    events: 7,
    navigations: 1,
    redirects: 0,
    subresources: 1,
    extractions: 1,
    screenshots: 1,
    actions: 3,
    extractionBytes: Buffer.byteLength("synthetic read-only page text"),
    screenshotBytes: Buffer.byteLength("synthetic-frame"),
    distinctHosts: 1,
  });
  const rendered = JSON.stringify(diagnostic);
  expect(rendered).toContain("synthetic-evidence-only");
});

test("intent fingerprint is stable, content-derived and independent of key order", () => {
  const base = intentInput();
  const reordered = parseBrowserIntent({
    totalMs: base.totalMs,
    maxActions: base.maxActions,
    maxNavigations: base.maxNavigations,
    actions: base.actions,
    allowlist: base.allowlist,
    initialUrl: base.initialUrl,
    actionRevision: base.actionRevision,
  });
  expect(browserIntentFingerprint(reordered)).toBe(
    browserIntentFingerprint(INTENT),
  );
  expect(browserIntentFingerprint(INTENT)).toBe(
    createHash("sha256")
      .update(
        JSON.stringify(
          Object.fromEntries(
            Object.entries({
              actionRevision: INTENT.actionRevision,
              initialUrl: INTENT.initialUrl,
              initialOrigin: INTENT.initialOrigin,
              initialPath: INTENT.initialPath,
              allowlist: INTENT.allowlist.map((rule) => ({
                origin: rule.origin,
                paths: [...rule.paths],
              })),
              actions: [...INTENT.actions],
              maxNavigations: INTENT.maxNavigations,
              maxActions: INTENT.maxActions,
              totalMs: INTENT.totalMs,
            }).sort(([a], [b]) => (a < b ? -1 : 1)),
          ),
        ),
      )
      .digest("hex"),
  );
  const other = parseBrowserIntent(
    intentInput({ initialUrl: `${HOST}/docs/style.css` }),
  );
  expect(browserIntentFingerprint(other)).not.toBe(
    browserIntentFingerprint(INTENT),
  );
});

test("parsed intents are deep-frozen with exactly the declared fields and fixed limits", () => {
  expect(Object.keys(INTENT).sort()).toEqual(
    [
      "actionRevision",
      "initialUrl",
      "initialOrigin",
      "initialPath",
      "allowlist",
      "actions",
      "maxNavigations",
      "maxActions",
      "totalMs",
    ].sort(),
  );
  expect(INTENT.maxNavigations).toBe(3);
  expect(INTENT.maxActions).toBe(10);
  expect(INTENT.totalMs).toBe(60_000);
  expect(() => (INTENT.allowlist as unknown[]).push({} as never)).toThrow();
  expect(() =>
    (INTENT.allowlist[0].paths as unknown[]).push("/extra" as never),
  ).toThrow();
  expect(Object.isFrozen(BROWSER_ACTIONS)).toBe(true);
});

test("hostile intent spellings are rejected without normalization into approval", () => {
  const hostile = [
    "https://user:pass@example.com/docs/page",
    "http://example.com/docs/page",
    "https://example.com:8443/docs/page",
    "https://127.0.0.1/docs/page",
    "https://[::1]/docs/page",
    "https://[::ffff:127.0.0.1]/docs/page",
    "https://localhost/docs/page",
    "https://service.internal/docs/page",
    "https://api.local/docs/page",
    "https://example.com./docs/page",
    "https://xn--80ak6aa92e.com/docs/page",
    "https://EXAMPLE.com/docs/page",
    "HTTPS://example.com/docs/page",
    "https://example.com",
    "https://example.com/docs/%70age",
    "https://example.com/docs/page?q=1",
    "https://example.com/docs/page#frag",
    "https://example.com/docs/../secret/page",
    "https://example.com/docs/./page",
    "https://example.com//docs/page",
    "https://example.com/docs/page;params",
    "https://192.168.1.4/docs/page",
    "https://metadata.internal/docs/page",
  ];
  for (const initialUrl of hostile) {
    expect(() => parseBrowserIntent(intentInput({ initialUrl }))).toThrow(
      "browser_intent_rejected",
    );
  }
});

test("wildcards, suffix rules and oversized allowlists are rejected", () => {
  const cases = [
    intentInput({ allowlist: [{ origin: HOST, paths: ["/docs/*"] }] }),
    intentInput({ allowlist: [{ origin: HOST, paths: ["/*"] }] }),
    intentInput({
      allowlist: [{ origin: "https://*.example.com", paths: ["/"] }],
    }),
    intentInput({
      allowlist: [{ origin: HOST, paths: ["/docs"] }],
      initialUrl: `${HOST}/docs/page`,
    }),
    { ...intentInput(), extra: true },
    { ...intentInput(), actionRevision: "browser-intent-v2" },
    { ...intentInput(), actions: ["navigate", "extract-text"] },
    {
      ...intentInput(),
      actions: ["navigate", "extract-text", "screenshot", "download"],
    },
    {
      ...intentInput(),
      allowlist: Array.from(
        { length: BROWSER_LIMITS.allowlistOrigins + 1 },
        (_, i) => ({
          origin: `https://host${i}.example.com`,
          paths: ["/"],
        }),
      ),
    },
    {
      ...intentInput(),
      allowlist: [
        {
          origin: HOST,
          paths: Array.from(
            { length: BROWSER_LIMITS.pathsPerOrigin + 1 },
            (_, i) => `/p${i}`,
          ),
        },
      ],
    },
    intentInput({
      allowlist: [{ origin: HOST, paths: ["/docs/page", "/docs/page"] }],
    }),
    intentInput({
      allowlist: [
        { origin: HOST, paths: ["/docs/page"] },
        { origin: HOST, paths: ["/x"] },
      ],
    }),
    intentInput({ allowlist: "https://example.com" }),
    intentInput({ maxNavigations: 5 }),
    intentInput({ maxActions: 100 }),
    intentInput({ totalMs: 600_000 }),
  ];
  for (const input of cases) {
    expect(() => parseBrowserIntent(input)).toThrow("browser_intent_rejected");
  }
});

test("an explicitly empty allowlist is a valid candidate that approves nothing", () => {
  const empty = parseBrowserIntent(intentInput({ allowlist: [] }));
  expect(empty.allowlist).toEqual([]);
  const diagnostic = evaluate(
    [
      { kind: "session", at: 1000 },
      ...evidenceEvents(1100),
      { kind: "navigate", at: 1300, url: INITIAL_URL, method: "GET" },
    ],
    empty,
  );
  expect(diagnostic.accepted).toBe(false);
  expect(codesOf(diagnostic)).toContain("destination_not_allowed");
});

test("trace bounds reject oversized and unparseable input before per-event work", () => {
  const flooded = {
    events: Array.from({ length: BROWSER_LIMITS.maxTraceEvents + 1 }, () => ({
      kind: "websocket",
    })),
  };
  const floodedResult = evaluateBrowserTrace(INTENT, flooded);
  expect(codesOf(floodedResult)).toEqual(["trace_event_overflow"]);
  expect(floodedResult.counts.events).toBe(0);

  const huge = {
    events: [{ kind: "session", at: 0, blob: "x".repeat(5 * 1024 * 1024) }],
  };
  expect(codesOf(evaluateBrowserTrace(INTENT, huge))).toEqual([
    "trace_too_large",
  ]);

  const cyclic: { events: unknown[] } = { events: [] };
  cyclic.events.push(cyclic);
  expect(codesOf(evaluateBrowserTrace(INTENT, cyclic))).toEqual([
    "trace_unparseable",
  ]);

  expect(codesOf(evaluateBrowserTrace(INTENT, { nope: true }))).toEqual([
    "trace_unparseable",
  ]);
  expect(codesOf(evaluateBrowserTrace(INTENT, { events: "nope" }))).toEqual([
    "trace_unparseable",
  ]);
});

test("session and page rules: one fresh session, no extra pages", () => {
  const withoutSession = evaluate([
    { kind: "navigate", at: 1000, url: INITIAL_URL, method: "GET" },
  ]);
  expect(codesOf(withoutSession)).toContain("missing_session");
  expect(withoutSession.accepted).toBe(false);

  const extraPage = evaluate([
    { kind: "session", at: 1000 },
    { kind: "session", at: 1100 },
  ]);
  expect(codesOf(extraPage)).toContain("extra_session");
  expect(extraPage.accepted).toBe(false);
});

test("time rules: nonmonotonic stamps and deadline renewal attempts are denied", () => {
  const backwards = evaluate([
    { kind: "session", at: 2000 },
    { kind: "session", at: 1000 },
  ]);
  expect(codesOf(backwards)).toContain("nonmonotonic_time");

  // Monotonic stamps cannot renew the original 60s deadline.
  const renewal = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "resolved",
      at: 50_000,
      hostname: "example.com",
      answers: [PUBLIC_V4],
    },
    { kind: "session", at: 70_000 },
  ]);
  expect(codesOf(renewal)).toContain("deadline_exceeded");

  const justLate = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "resolved",
      at: 1000 + BROWSER_LIMITS.totalMs + 1,
      hostname: "example.com",
      answers: [PUBLIC_V4],
    },
  ]);
  expect(codesOf(justLate)).toContain("deadline_exceeded");

  const atDeadline = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "resolved",
      at: 1000 + BROWSER_LIMITS.totalMs,
      hostname: "example.com",
      answers: [PUBLIC_V4],
    },
  ]);
  expect(codesOf(atDeadline)).toEqual([]);

  for (const at of [1.5, "1000", Number.MAX_SAFE_INTEGER + 1, -0.5]) {
    const malformed = evaluate([{ kind: "session", at }]);
    expect(codesOf(malformed)).toContain("event_malformed");
  }
});

test("navigation and action exhaustion", () => {
  const events: unknown[] = [
    { kind: "session", at: 1000 },
    ...evidenceEvents(1100),
  ];
  for (let i = 1; i <= 4; i++) {
    events.push({
      kind: "navigate",
      at: 2000 + i,
      url: i === 1 ? INITIAL_URL : `${HOST}/p${i}`,
      method: "GET",
    });
  }
  const diagnostic = evaluate(events);
  expect(codesOf(diagnostic)).toContain("navigation_exhausted");
  expect(diagnostic.counts.navigations).toBe(4);

  const actionEvents: unknown[] = [
    { kind: "session", at: 1000 },
    ...evidenceEvents(1100),
    { kind: "navigate", at: 1300, url: INITIAL_URL, method: "GET" },
  ];
  for (let i = 1; i <= 9; i++) {
    actionEvents.push({
      kind: "extract-text",
      at: 2000 + i,
      url: `${HOST}/p${i}`,
      text: "x",
    });
  }
  const actionResult = evaluate(actionEvents);
  expect(actionResult.accepted).toBe(true);
  expect(codesOf(actionResult)).toEqual([]);
  expect(actionResult.counts.actions).toBe(10);

  const overActions: unknown[] = [...actionEvents];
  overActions.push({
    kind: "screenshot",
    at: 3000,
    url: INITIAL_URL,
    data: Buffer.from("x").toString("base64"),
  });
  expect(codesOf(evaluate(overActions))).toContain("action_exhausted");
});

test("forbidden vocabulary and unknown events are denied with fixed codes", () => {
  for (const kind of [
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
  ]) {
    const diagnostic = evaluate([
      { kind: "session", at: 1000 },
      { kind, at: 1100 },
    ]);
    expect(codesOf(diagnostic)).toEqual(["forbidden_event"]);
  }
  const unknown = evaluate([
    { kind: "session", at: 1000 },
    { kind: "render", at: 1100 },
  ]);
  expect(codesOf(unknown)).toEqual(["event_unrecognized"]);
  expect(
    codesOf(
      evaluate([{ kind: "session", at: 1000 }, "not-an-object" as never]),
    ),
  ).toEqual(["event_unrecognized"]);
});

test("non-GET methods are denied even for allowlisted destinations", () => {
  for (const [kind, url] of [
    ["navigate", INITIAL_URL],
    ["redirect", `${HOST}/docs/style.css`],
    ["subresource", `${HOST}/docs/style.css`],
  ] as const) {
    const diagnostic = evaluate([
      { kind: "session", at: 1000 },
      ...evidenceEvents(1100),
      { kind: "navigate", at: 1300, url: INITIAL_URL, method: "GET" },
      { kind, at: 1400, url, method: "POST" },
    ]);
    expect(codesOf(diagnostic)).toContain("method_not_get");
  }
});

test("redirects and subresources need their own exact allowed destination", () => {
  const redirectEscape = evaluate([
    { kind: "session", at: 1000 },
    ...evidenceEvents(1100),
    { kind: "navigate", at: 1300, url: INITIAL_URL, method: "GET" },
    {
      kind: "redirect",
      at: 1400,
      url: "https://example.org/other",
      method: "GET",
    },
  ]);
  expect(codesOf(redirectEscape)).toEqual(["destination_not_allowed"]);

  const unlistedPath = evaluate([
    { kind: "session", at: 1000 },
    ...evidenceEvents(1100),
    { kind: "navigate", at: 1300, url: INITIAL_URL, method: "GET" },
    { kind: "redirect", at: 1400, url: `${HOST}/unlisted`, method: "GET" },
  ]);
  expect(codesOf(unlistedPath)).toEqual(["destination_not_allowed"]);

  const allowed = evaluate([
    { kind: "session", at: 1000 },
    ...evidenceEvents(1100),
    { kind: "navigate", at: 1300, url: INITIAL_URL, method: "GET" },
    {
      kind: "redirect",
      at: 1400,
      url: `${HOST}/docs/style.css`,
      method: "GET",
    },
  ]);
  expect(allowed.accepted).toBe(true);
  expect(allowed.counts.redirects).toBe(1);
});

test("hostile trace URL forms are rejected before allowlist matching", () => {
  const hostile = [
    "https://user:pass@example.com/docs/style.css",
    "https://example.com/docs/style.css?x=1",
    "https://example.com/docs/style.css#f",
    "https://example.com:443/docs/style.cssx",
    "https://127.0.0.1/docs/style.css",
    "https://[::1]/docs/style.css",
    "https://[::ffff:127.0.0.1]/docs/style.css",
    "https://169.254.169.254/latest/meta-data/",
    "https://example.com./docs/style.css",
    "https://example.com/docs/%2e%2e/style.css",
    "https://example.com//docs/style.css",
    "https://example.com/docs/../style.css",
    "not a url",
    "https://example.com:8443/docs/style.css",
  ];
  for (const url of hostile) {
    const diagnostic = evaluate([
      { kind: "session", at: 1000 },
      ...evidenceEvents(1100),
      { kind: "navigate", at: 1300, url: INITIAL_URL, method: "GET" },
      { kind: "subresource", at: 1400, url, method: "GET" },
    ]);
    expect(diagnostic.accepted).toBe(false);
    expect(codesOf(diagnostic).length).toBeGreaterThan(0);
  }
  // IP-literal/internal hosts are flagged before destination matching.
  expect(
    codesOf(
      evaluate([
        { kind: "session", at: 1000 },
        ...evidenceEvents(1100),
        { kind: "navigate", at: 1300, url: INITIAL_URL, method: "GET" },
        {
          kind: "subresource",
          at: 1400,
          url: "https://127.0.0.1/x",
          method: "GET",
        },
      ]),
    ),
  ).toContain("url_not_canonical");
  expect(
    codesOf(
      evaluate([
        { kind: "session", at: 1000 },
        ...evidenceEvents(1100),
        { kind: "navigate", at: 1300, url: INITIAL_URL, method: "GET" },
        {
          kind: "subresource",
          at: 1400,
          url: "https://host.internal/x",
          method: "GET",
        },
      ]),
    ),
  ).toContain("hostname_not_allowed");
});

test("the first navigation must be the intent's exact initial URL", () => {
  const diagnostic = evaluate([
    { kind: "session", at: 1000 },
    ...evidenceEvents(1100),
    {
      kind: "navigate",
      at: 1300,
      url: `${HOST}/docs/style.css`,
      method: "GET",
    },
  ]);
  expect(codesOf(diagnostic)).toEqual(["destination_not_allowed"]);
});

test("address evidence: missing resolution, missing connection and rebinding", () => {
  const noEvidence = evaluate([
    { kind: "session", at: 1000 },
    { kind: "navigate", at: 1300, url: INITIAL_URL, method: "GET" },
  ]);
  expect(codesOf(noEvidence)).toContain("address_evidence_missing");

  const noConnected = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "resolved",
      at: 1100,
      hostname: "example.com",
      answers: [PUBLIC_V4],
    },
    { kind: "navigate", at: 1300, url: INITIAL_URL, method: "GET" },
  ]);
  expect(codesOf(noConnected)).toContain("address_evidence_missing");

  const rebound = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "resolved",
      at: 1100,
      hostname: "example.com",
      answers: [PUBLIC_V4],
    },
    {
      kind: "connected",
      at: 1200,
      hostname: "example.com",
      address: "203.0.113.9",
      family: 4,
    },
  ]);
  // 203.0.113.9 is documentation space: denied as non-public first.
  expect(codesOf(rebound)).toContain("address_not_public");

  const rebinding = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "resolved",
      at: 1100,
      hostname: "example.com",
      answers: [PUBLIC_V4],
    },
    {
      kind: "connected",
      at: 1200,
      hostname: "example.com",
      address: "93.184.216.35",
      family: 4,
    },
  ]);
  expect(codesOf(rebinding)).toEqual(["address_rebinding"]);

  const secondPublic = {
    address: "2606:2800:21f:cb07:6820:80da:af6b:8b2c",
    family: 6,
  };
  const changedAnswers = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "resolved",
      at: 1100,
      hostname: "example.com",
      answers: [PUBLIC_V4],
    },
    {
      kind: "resolved",
      at: 1150,
      hostname: "example.com",
      answers: [secondPublic],
    },
  ]);
  expect(codesOf(changedAnswers)).toEqual(["address_rebinding"]);

  const changedToMixed = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "resolved",
      at: 1100,
      hostname: "example.com",
      answers: [PUBLIC_V4],
    },
    {
      kind: "resolved",
      at: 1150,
      hostname: "example.com",
      answers: [PUBLIC_V4, { address: "10.0.0.7", family: 4 }],
    },
  ]);
  expect(codesOf(changedToMixed)).toEqual(["address_not_public"]);

  const noResolvedForConnected = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "connected",
      at: 1200,
      hostname: "example.com",
      address: PUBLIC_V4.address,
      family: 4,
    },
  ]);
  expect(codesOf(noResolvedForConnected)).toEqual(["address_evidence_missing"]);
});

test("private, metadata, mapped and documentation addresses are non-public", () => {
  for (const answer of [
    { address: "10.1.2.3", family: 4 },
    { address: "172.16.0.9", family: 4 },
    { address: "192.168.0.1", family: 4 },
    { address: "169.254.169.254", family: 4 },
    { address: "127.0.0.1", family: 4 },
    { address: "0.0.0.0", family: 4 },
    { address: "192.0.2.1", family: 4 },
    { address: "198.51.100.7", family: 4 },
    { address: "100.64.0.1", family: 4 },
    { address: "100.100.100.100", family: 4 },
    { address: "fd00::1", family: 6 },
    { address: "::1", family: 6 },
    { address: "::ffff:10.0.0.1", family: 6 },
    { address: "fe80::1", family: 6 },
    { address: "2001:db8::1", family: 6 },
  ]) {
    const diagnostic = evaluate([
      { kind: "session", at: 1000 },
      {
        kind: "resolved",
        at: 1100,
        hostname: "example.com",
        answers: [answer],
      },
    ]);
    expect(codesOf(diagnostic)).toEqual(["address_not_public"]);
  }

  const mixed = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "resolved",
      at: 1100,
      hostname: "example.com",
      answers: [PUBLIC_V4, { address: "192.168.1.1", family: 4 }],
    },
  ]);
  expect(codesOf(mixed)).toEqual(["address_not_public"]);

  const familyMismatch = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "resolved",
      at: 1100,
      hostname: "example.com",
      answers: [{ address: "93.184.216.34", family: 6 }],
    },
  ]);
  expect(codesOf(familyMismatch)).toEqual(["address_not_public"]);

  const tooMany = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "resolved",
      at: 1100,
      hostname: "example.com",
      answers: Array.from(
        { length: BROWSER_LIMITS.maxResolvedAnswers + 1 },
        () => PUBLIC_V4,
      ),
    },
  ]);
  expect(codesOf(tooMany)).toEqual(["address_evidence_invalid"]);

  const literalHostname = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "resolved",
      at: 1100,
      hostname: "93.184.216.34",
      answers: [PUBLIC_V4],
    },
  ]);
  expect(codesOf(literalHostname)).toEqual(["hostname_not_allowed"]);

  const internalHostname = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "resolved",
      at: 1100,
      hostname: "metadata.google.internal",
      answers: [PUBLIC_V4],
    },
  ]);
  expect(codesOf(internalHostname)).toEqual(["hostname_not_allowed"]);
});

test("extraction and screenshot byte limits use actual measured bytes", () => {
  const atLimit = Buffer.alloc(BROWSER_LIMITS.extractionBytes, 0x61).toString(
    "latin1",
  );
  const pass = evaluate([
    { kind: "session", at: 1000 },
    { kind: "extract-text", at: 1100, url: INITIAL_URL, text: atLimit },
  ]);
  expect(codesOf(pass)).toEqual([]);
  expect(pass.counts.extractionBytes).toBe(BROWSER_LIMITS.extractionBytes);

  const overLimit = `${atLimit}x`;
  expect(
    codesOf(
      evaluate([
        { kind: "session", at: 1000 },
        { kind: "extract-text", at: 1100, url: INITIAL_URL, text: overLimit },
      ]),
    ),
  ).toEqual(["extraction_too_large"]);

  const multibyteAtLimit = "é".repeat(BROWSER_LIMITS.extractionBytes / 2);
  const multibytePass = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "extract-text",
      at: 1100,
      url: INITIAL_URL,
      text: multibyteAtLimit,
    },
  ]);
  expect(codesOf(multibytePass)).toEqual([]);
  expect(multibytePass.counts.extractionBytes).toBe(
    BROWSER_LIMITS.extractionBytes,
  );

  const multibyteOver = `${multibyteAtLimit}é`;
  expect(
    codesOf(
      evaluate([
        { kind: "session", at: 1000 },
        {
          kind: "extract-text",
          at: 1100,
          url: INITIAL_URL,
          text: multibyteOver,
        },
      ]),
    ),
  ).toEqual(["extraction_too_large"]);

  const maxShot = Buffer.alloc(BROWSER_LIMITS.screenshotBytes, 7).toString(
    "base64",
  );
  const shotPass = evaluate([
    { kind: "session", at: 1000 },
    { kind: "screenshot", at: 1100, url: INITIAL_URL, data: maxShot },
  ]);
  expect(codesOf(shotPass)).toEqual([]);
  expect(shotPass.counts.screenshotBytes).toBe(BROWSER_LIMITS.screenshotBytes);

  const shotOver = Buffer.alloc(BROWSER_LIMITS.screenshotBytes + 1, 7).toString(
    "base64",
  );
  expect(
    codesOf(
      evaluate([
        { kind: "session", at: 1000 },
        { kind: "screenshot", at: 1100, url: INITIAL_URL, data: shotOver },
      ]),
    ),
  ).toEqual(["screenshot_too_large"]);

  expect(
    codesOf(
      evaluate([
        { kind: "session", at: 1000 },
        {
          kind: "screenshot",
          at: 1100,
          url: INITIAL_URL,
          data: "not base64!!",
        },
      ]),
    ),
  ).toEqual(["payload_unparseable"]);
});

test("forged claimed byte counts are detected against measurement", () => {
  const forgedExtract = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "extract-text",
      at: 1100,
      url: INITIAL_URL,
      text: "abcdefgh",
      claimedBytes: 1,
    },
  ]);
  expect(codesOf(forgedExtract)).toEqual(["claimed_bytes_mismatch"]);

  const data = Buffer.from("abcdefgh").toString("base64");
  const forgedShot = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "screenshot",
      at: 1100,
      url: INITIAL_URL,
      data,
      claimedBytes: Buffer.byteLength(data),
    },
  ]);
  expect(codesOf(forgedShot)).toEqual(["claimed_bytes_mismatch"]);

  // A forged small claim cannot smuggle an oversized payload past measurement;
  // this one still fits the trace byte bound so the payload bound is exercised.
  const smuggled = Buffer.alloc(
    Math.floor(BROWSER_LIMITS.screenshotBytes * 1.25),
    7,
  ).toString("base64");
  expect(
    codesOf(
      evaluate([
        { kind: "session", at: 1000 },
        {
          kind: "screenshot",
          at: 1100,
          url: INITIAL_URL,
          data: smuggled,
          claimedBytes: 1,
        },
      ]),
    ),
  ).toEqual(["screenshot_too_large"]);

  const honestExtract = evaluate([
    { kind: "session", at: 1000 },
    {
      kind: "extract-text",
      at: 1100,
      url: INITIAL_URL,
      text: "abcdefgh",
      claimedBytes: 8,
    },
  ]);
  expect(codesOf(honestExtract)).toEqual([]);
});

test("reports are sanitized: no URLs, payloads or input-derived strings", () => {
  const secretText = "topsecret-extracted-body-content";
  const diagnostic = evaluate([
    { kind: "session", at: 1000 },
    ...evidenceEvents(1100),
    {
      kind: "navigate",
      at: 1300,
      url: "https://user:pass@example.com/docs/page",
      method: "GET",
    },
    {
      kind: "extract-text",
      at: 1400,
      url: INITIAL_URL,
      text: secretText,
      claimedBytes: 3,
    },
  ]);
  const rendered = JSON.stringify(diagnostic);
  expect(rendered).not.toContain("user:pass");
  expect(rendered).not.toContain(secretText);
  expect(rendered).not.toContain("example.com");
  for (const violation of diagnostic.violations) {
    expect(
      Object.keys(violation).every((key) => ["code", "index"].includes(key)),
    ).toBe(true);
    expect(BROWSER_VIOLATION_CODES).toContain(violation.code);
  }
  try {
    parseBrowserIntent({ nonsense: true });
    expect.unreachable();
  } catch (error) {
    expect(error instanceof BrowserPolicyError).toBe(true);
    expect((error as BrowserPolicyError).message).toBe(
      "browser_intent_rejected",
    );
    expect((error as BrowserPolicyError).code).toBe("browser_intent_rejected");
  }
});
