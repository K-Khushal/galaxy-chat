import { mock } from "bun:test";
import { privateKey } from "./beta-fixture";
import { mcpOperationFixture } from "./mcp-operation-fixture";

mock.module("server-only", () => ({}));
const { createFixtureMcpCatalogStore, mcpToolRunRequestDigest } = await import(
  "@/lib/mcp/catalog-store"
);
const { parseCatalogImport } = await import("@/lib/mcp/catalog-contract");
const { operationDigest } = await import("@/lib/mcp/operation-contract");
const { ToolStore } = await import("@/lib/tools/store");
const { toolRunRequest } = await import("@/lib/tools/contract");
const { resolveToolModel, toolEstimate } = await import("@/lib/tools/config");
const { ByokStore } = await import("@/lib/byok/store");
const { resourceDigest } = await import("@/lib/byok/config");

export const catalogInputSchema = {
  type: "object",
  properties: {
    message: { type: "string", maxLength: 128 },
    count: { type: "integer", minimum: 0, maximum: 10 },
  },
  required: ["message"],
  additionalProperties: false,
};
export async function mcpCatalogFixture() {
  const fixture = await mcpOperationFixture();
  Object.assign(process.env, fixture.env, {
    TOOLS_ENABLED: "1",
    TOOL_APPROVAL_SECRET:
      "synthetic-offline-approval-secret-not-functional-32chars",
    TOOL_MODELS_JSON: JSON.stringify([
      {
        id: "SYNTHETIC-OFFLINE",
        adapter: "openrouter",
        model: "fixture/tools",
        provider: "fixture",
        verified: true,
        tools: true,
        reasoning: false,
        providerBudgetVerified: true,
        expiresAt: "2030-01-01T00:00:00.000Z",
        inputMicrodollarsPerMillion: 1000,
        outputMicrodollarsPerMillion: 1000,
      },
    ]),
  });
  const store = createFixtureMcpCatalogStore({
    db: fixture.db,
    runtime: () => ({ fee: fixture.runtime.fee }),
  });
  const tools = new ToolStore(fixture.db),
    byok = new ByokStore(fixture.db);
  const saved = new Set<string>();
  function catalogInput(
    owner = "alice",
    overrides: Record<string, unknown> = {},
  ) {
    const intent = fixture.intent(owner);
    return {
      id: crypto.randomUUID(),
      revision: "offline-v1",
      expectedHeadRevision: null,
      connection: intent.connection,
      profile: { ...intent.profile, purpose: "mcp.call" as const },
      tools: [
        {
          name: "write_note",
          description:
            "Untrusted offline fixture text, never model instructions",
          inputSchema: catalogInputSchema,
          outputSchema: null,
          annotations: { readOnlyHint: true },
        },
      ],
      ...overrides,
    };
  }
  async function catalog(
    owner = "alice",
    overrides: Parameters<typeof catalogInput>[1] = {},
  ) {
    const input = catalogInput(owner, overrides);
    const metadata = await store.importUntrusted(owner, input);
    return {
      input,
      metadata,
      identity: {
        id: input.id,
        revision: input.revision,
        digest: parseCatalogImport(input).digest,
      },
    };
  }
  async function run(owner = "alice") {
    if (!saved.has(owner)) {
      await byok.save(owner, "openrouter", privateKey, process.env, null);
      saved.add(owner);
    }
    const selected = resolveToolModel(
        process.env,
        "SYNTHETIC-OFFLINE",
        "openrouter",
      ),
      amount = toolEstimate(selected);
    const request = toolRunRequest.parse({
      id: crypto.randomUUID(),
      prompt: "Synthetic local persistence fixture; no provider execution",
      funding: "openrouter",
      model: selected.id,
      estimateMicrodollars: amount,
      ceilingMicrodollars: amount,
      providerBudgetAcknowledged: true,
      revisions: [],
    });
    await tools.create(owner, request);
    await byok.reserve({
      id: request.id,
      userId: owner,
      provider: "openrouter",
      kind: "chat",
      resourceUnits: 3,
      digest: resourceDigest(
        JSON.stringify({ request, selected }),
        process.env,
      ),
      env: process.env,
    });
    await byok.enter(request.id, owner, process.env);
    await tools.step({
      id: request.id,
      userId: owner,
      env: process.env,
      step: 0,
      inputBytes: 100,
      outputTokens: 170,
      revisions: [],
    });
    return {
      id: request.id,
      request,
      requestDigest: mcpToolRunRequestDigest(request),
    };
  }
  async function call(
    runId: string,
    owner = "alice",
    id = crypto.randomUUID(),
  ) {
    await tools.event(owner, runId, {
      id,
      name: "mcp:write_note",
      state: "queued",
    });
    return id;
  }
  type ImportedCatalog = Awaited<ReturnType<typeof catalog>>;
  type OwnedRun = Awaited<ReturnType<typeof run>>;
  function proposal(
    ownedCatalog: ImportedCatalog,
    ownedRun: OwnedRun,
    callId: string,
  ) {
    return {
      id: crypto.randomUUID(),
      catalog: ownedCatalog.identity,
      action: "write_note",
      runId: ownedRun.id,
      toolCallId: callId,
      requestDigest: ownedRun.requestDigest,
      arguments: { message: "synthetic note", count: 2 },
      target: "owned-fixture-target",
      feeDigest: operationDigest(fixture.runtime.fee),
      plan: fixture.planIdentity,
    };
  }
  return {
    ...fixture,
    operations: fixture.store,
    store,
    tools,
    byok,
    catalogInput,
    catalog,
    run,
    call,
    proposal,
  };
}
