import { expect, mock, spyOn, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { encode } from "fast-png";

mock.module("server-only", () => ({}));
const { canonicalPng, inspectPng, IMAGE_BYTES } = await import(
  "../lib/images/png"
);
const { imageSnapshot, snapshotDigest, validateImageReview } = await import(
  "../lib/images/config"
);
const { boundedImageFetch, OpenRouterImageAdapter, requireImageCapability } =
  await import("../lib/images/adapter");

import { chunk, imageEnv, png, snapshot } from "./helpers/image-fixture";

function replaceIdat(data: Uint8Array) {
  const original = png();
  return new Uint8Array(
    Buffer.concat([
      original.subarray(0, 33),
      chunk("IDAT", data),
      chunk("IEND", new Uint8Array()),
    ]),
  );
}
function network(
  body: unknown,
  status = 200,
  onCall?: (init?: RequestInit) => void,
) {
  return Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      onCall?.(init);
      return Response.json(body, { status });
    },
    { preconnect: fetch.preconnect },
  );
}

test("F12-C canonical PNG validates before decoding, strips metadata, preserves pixels and fixes a stable digest", () => {
  const input = png(),
    result = canonicalPng(input, "image/png");
  expect(result.bytes.length).toBe(6380);
  expect(result.sha256).toBe(
    "9a3a5548fd49d9d0266e03ea5f549b5aa27d3f7dbbe13a70f4471210335d81ed",
  );
  const meta = new Uint8Array(
    Buffer.concat([
      input.subarray(0, 33),
      chunk(
        "zTXt",
        new Uint8Array([65, 0, 0, ...deflateSync(new Uint8Array(100_000))]),
      ),
      input.subarray(33),
    ]),
  );
  expect(canonicalPng(meta, "image/png").sha256).toBe(result.sha256);
  const padding = chunk(
    "tEXt",
    new Uint8Array(IMAGE_BYTES - input.length - 12),
  );
  const exact = new Uint8Array(
    Buffer.concat([input.subarray(0, 33), padding, input.subarray(33)]),
  );
  expect(exact.length).toBe(IMAGE_BYTES);
  expect(canonicalPng(exact, "image/png").sha256).toBe(result.sha256);
  expect(() =>
    canonicalPng(new Uint8Array(IMAGE_BYTES + 1), "image/png"),
  ).toThrow();
});
test("F12-C hostile PNGs fail: CRC, dimensions, APNG, wrong MIME/magic, critical chunks, truncated or expanded pixel streams", () => {
  const original = png(),
    broken = original.slice();
  broken[45] ^= 1;
  expect(() => inspectPng(broken)).toThrow();
  const wrong = encode({
    width: 1,
    height: 1,
    channels: 4,
    data: new Uint8Array(4),
  });
  expect(() => canonicalPng(wrong, "image/png")).toThrow();
  expect(() => canonicalPng(original, "image/svg+xml")).toThrow();
  expect(() =>
    canonicalPng(new TextEncoder().encode("<svg>"), "image/png"),
  ).toThrow();
  for (const name of ["acTL", "fcTL", "fdAT", "ABCD"])
    expect(() =>
      inspectPng(
        new Uint8Array(
          Buffer.concat([
            original.subarray(0, 33),
            chunk(name, new Uint8Array(8)),
            original.subarray(33),
          ]),
        ),
      ),
    ).toThrow();
  expect(() => inspectPng(original.subarray(0, original.length - 1))).toThrow();
  expect(() =>
    inspectPng(
      replaceIdat(deflateSync(new Uint8Array(1024 * (1024 * 4 + 1) + 1))),
    ),
  ).toThrow();
  expect(() =>
    inspectPng(replaceIdat(deflateSync(new Uint8Array(10)))),
  ).toThrow();
});
test("F12-C one reviewed default-off route, safe prices/expiry/strict shape and capability denial", () => {
  expect(() => imageSnapshot({})).toThrow();
  expect(imageSnapshot(imageEnv)).toEqual(snapshot);
  for (const value of [
    [],
    [snapshot, snapshot],
    [{ ...snapshot, extra: true }],
    [{ ...snapshot, expiresAt: "2020-01-01T00:00:00Z" }],
    [{ ...snapshot, worstCaseEstimateMicrodollars: 1 }],
    [
      {
        ...snapshot,
        providerMaxMicrodollarsPerImage: Number.MAX_SAFE_INTEGER + 1,
      },
    ],
    [{ ...snapshot, edit: true }],
  ])
    expect(() =>
      imageSnapshot({ ...imageEnv, IMAGE_MODELS_JSON: JSON.stringify(value) }),
    ).toThrow();
  const request = {
    modelId: snapshot.id,
    reviewDigest: snapshotDigest(snapshot),
    estimateMicrodollars: 120000,
    ceilingMicrodollars: 120000,
    providerBudgetAcknowledged: true,
  } as Parameters<typeof validateImageReview>[0];
  expect(() => validateImageReview(request, snapshot)).not.toThrow();
  for (const change of [
    { estimateMicrodollars: 119999 },
    { ceilingMicrodollars: 119999 },
    { providerBudgetAcknowledged: false },
    { reviewDigest: "0".repeat(64) },
    { reference: { id: crypto.randomUUID(), sha256: "a".repeat(64) } },
  ])
    expect(() =>
      validateImageReview(
        { ...request, ...change } as typeof request,
        snapshot,
      ),
    ).toThrow();
  const model = createOpenRouter({ apiKey: "not-sent" }).imageModel(
    "fixture/image",
  );
  expect(() => requireImageCapability(model, true, false)).toThrow();
  expect(() => requireImageCapability(model, false, true)).toThrow();
  expect(() => requireImageCapability(model, false, false)).not.toThrow();
});
test("F12-C actual installed SDK sends only the user key, one exact provider, fixed output, one call and no fallback", async () => {
  let calls = 0;
  const key = "offline-user-key-1111",
    bytes = png();
  const adapter = new OpenRouterImageAdapter(
    network(
      { data: [{ b64_json: Buffer.from(bytes).toString("base64") }] },
      200,
      (init) => {
        calls++;
        expect(init?.redirect).toBe("manual");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `Bearer ${key}`,
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          model: snapshot.model,
          prompt: "offline private prompt",
          n: 1,
          size: "1024x1024",
          provider: {
            only: [snapshot.provider],
            order: [snapshot.provider],
            allow_fallbacks: false,
            require_parameters: true,
            max_price: { image: "0.100000" },
          },
        });
      },
    ),
  );
  expect(
    (
      await adapter.generate({
        key,
        prompt: "offline private prompt",
        model: snapshot,
        signal: new AbortController().signal,
      })
    ).sha256,
  ).toBe(canonicalPng(bytes, "image/png").sha256);
  expect(calls).toBe(1);
});
test("F12-C bounded provider responses cancel redirects/oversize and refuse URL/multiple/invalid base64", async () => {
  let cancelled = 0;
  for (const response of [
    () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
          },
        }),
        { status: 302, headers: { location: "https://evil.invalid" } },
      ),
    () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
          },
        }),
        { headers: { "content-length": "99999999" } },
      ),
  ]) {
    const fetcher = boundedImageFetch(
      Object.assign(async () => response(), { preconnect: fetch.preconnect }),
    );
    await expect(
      fetcher("https://openrouter.ai/api/v1/images", { method: "POST" }),
    ).rejects.toThrow();
  }
  expect(cancelled).toBe(2);
  for (const data of [
    [],
    [{ url: "https://evil.invalid" }],
    [{ b64_json: "http://evil.invalid" }],
    [{ b64_json: "eA==" }, { b64_json: "eA==" }],
    [{ b64_json: "data:image/png;base64,eA==" }],
    [{ b64_json: Buffer.alloc(IMAGE_BYTES + 1).toString("base64") }],
  ])
    await expect(
      boundedImageFetch(network({ data }))(
        "https://openrouter.ai/api/v1/images",
        { method: "POST" },
      ),
    ).rejects.toThrow();
  let called = 0;
  await expect(
    boundedImageFetch(network({}, 200, () => called++))(
      "https://evil.invalid",
      { method: "POST" },
    ),
  ).rejects.toThrow();
  expect(called).toBe(0);
});
test("F12-C SDK has zero retry and the combined 60-second abort is wired", async () => {
  let calls = 0,
    timeoutSeen = false;
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  const spy = spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    if (ms === 60_000) timeoutSeen = true;
    return realTimeout(100);
  });
  try {
    const adapter = new OpenRouterImageAdapter(
      Object.assign(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          calls++;
          await new Promise<void>((_, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(Error("offline abort")),
              { once: true },
            );
          });
          return Response.json({});
        },
        { preconnect: fetch.preconnect },
      ),
    );
    await expect(
      adapter.generate({
        key: "offline-key",
        prompt: "offline",
        model: snapshot,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
    expect(timeoutSeen).toBe(true);
  } finally {
    spy.mockRestore();
  }
  calls = 0;
  await expect(
    new OpenRouterImageAdapter(
      network(
        { error: { message: "seeded-private-provider-error" } },
        500,
        () => calls++,
      ),
    ).generate({
      key: "offline-key",
      prompt: "offline",
      model: snapshot,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow();
  expect(calls).toBe(1);
});

test("F12-C streamed overflow cancels transport before parsing any provider payload", async () => {
  let cancelled = false;
  const fetcher = boundedImageFetch(
    Object.assign(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new Uint8Array(1_048_576));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
      { preconnect: fetch.preconnect },
    ),
  );
  await expect(
    fetcher("https://openrouter.ai/api/v1/images", { method: "POST" }),
  ).rejects.toThrow();
  expect(cancelled).toBe(true);
});
