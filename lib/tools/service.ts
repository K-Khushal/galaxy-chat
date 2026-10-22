import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGateway, wrapLanguageModel } from "ai";
import type { EnvSource } from "@/lib/auth/env";
import { resourceDigest } from "@/lib/byok/config";
import { ByokStore } from "@/lib/byok/store";
import { AppError } from "@/lib/errors";
import { runTavilySearch } from "@/lib/search/adapter";
import { resolveSearchConfig } from "@/lib/search/config";
import {
  SEARCH_LIMITS,
  type SearchEvidence,
  searchEvidenceSchema,
} from "@/lib/search/contract";
import { SearchStore } from "@/lib/search/store";
import { resolveToolModel, toolEstimate } from "./config";
import { TOOL_LIMITS, toolRunRequest } from "./contract";
import { wrappedToolResultBytes } from "./result-envelope";
import { runToolAgent } from "./runtime";
import { ToolStore, validateRevisions } from "./store";

export async function startToolRun(options: {
  userId: string;
  request: unknown;
  env: EnvSource;
  signal?: AbortSignal;
  model?: Parameters<typeof runToolAgent>[0]["model"];
  searchAdapter?: (options: {
    key: string;
    query: string;
    signal: AbortSignal;
  }) => Promise<SearchEvidence>;
}) {
  const signal = AbortSignal.any([
    AbortSignal.timeout(TOOL_LIMITS.timeoutMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  const request = toolRunRequest.parse(options.request);
  const approvalSecret = options.env.TOOL_APPROVAL_SECRET;
  if (!approvalSecret || approvalSecret.length < 32)
    throw new AppError("tools_unavailable", 503);
  const selected = resolveToolModel(
    options.env,
    request.model,
    request.funding,
  );
  const estimate = toolEstimate(selected);
  if (
    request.estimateMicrodollars !== estimate ||
    request.ceilingMicrodollars < estimate
  )
    throw new AppError("tool_funding_confirmation_required", 409);
  const searchConfig = request.search
    ? resolveSearchConfig(options.env)
    : undefined;
  if (
    request.search &&
    (!searchConfig ||
      request.search.priceRevision !== searchConfig.snapshot.id ||
      request.search.estimateMicrodollars !==
        searchConfig.snapshot.worstCaseMicrodollars ||
      request.search.ceilingMicrodollars <
        searchConfig.snapshot.worstCaseMicrodollars)
  )
    throw new AppError("search_funding_confirmation_required", 409);
  const searchSelection = request.search;
  const store = new ToolStore();
  const byok = new ByokStore();
  const searchStore = new SearchStore();
  await store.create(options.userId, request);
  let reserved = false;
  let entered = false;
  try {
    signal.throwIfAborted();
    await byok.reserve({
      id: request.id,
      userId: options.userId,
      provider: request.funding,
      kind: "chat",
      resourceUnits: 3,
      digest: resourceDigest(
        JSON.stringify({ request, selected }),
        options.env,
      ),
      env: options.env,
    });
    reserved = true;
    signal.throwIfAborted();
    const makeProvider = (key: string) =>
      options.model ??
      (selected.adapter === "openrouter"
        ? createOpenRouter({
            apiKey: key,
            fetch: Object.assign(
              async (input: RequestInfo | URL, init?: RequestInit) =>
                fetch(input, { ...init, redirect: "error" }),
              { preconnect: fetch.preconnect },
            ),
          }).chat(selected.model, {
            reasoning: { enabled: false, effort: "none" },
            provider: {
              only: [selected.provider],
              allow_fallbacks: false,
              require_parameters: true,
              max_price: {
                prompt: selected.inputMicrodollarsPerMillion / 1_000_000,
                completion: selected.outputMicrodollarsPerMillion / 1_000_000,
                request: 0,
              },
            },
          })
        : createGateway({
            apiKey: key,
            fetch: Object.assign(
              async (input: RequestInfo | URL, init?: RequestInit) =>
                fetch(input, { ...init, redirect: "error" }),
              { preconnect: fetch.preconnect },
            ),
          })(selected.model));
    let provider: ReturnType<typeof wrapLanguageModel> | undefined;
    const deferred: ReturnType<typeof wrapLanguageModel> = {
      specificationVersion: "v4",
      provider: selected.adapter,
      modelId: selected.model,
      supportedUrls: {},
      doGenerate: async (params) => {
        if (!provider) throw new AppError("tool_entry_denied", 409);
        return provider.doGenerate(params);
      },
      doStream: async () => {
        throw new AppError("tool_stream_denied", 409);
      },
    };
    const result = await runToolAgent({
      model: deferred,
      prompt: request.prompt,
      revisions: request.revisions,
      ...(request.search ? { search: request.search } : {}),
      approvalSecret,
      signal,
      ...(selected.adapter === "gateway"
        ? { providerOptions: { gateway: { only: [selected.provider] } } }
        : {}),
      hooks: {
        beforeModel: async (step, inputBytes, outputTokens) => {
          const current = resolveToolModel(
            options.env,
            request.model,
            request.funding,
          );
          if (JSON.stringify(current) !== JSON.stringify(selected))
            throw new AppError("tool_model_changed", 409);
          if (step === 0) {
            signal.throwIfAborted();
            const key = await byok.enter(
              request.id,
              options.userId,
              options.env,
              (tx) => validateRevisions(tx, options.userId, request.revisions),
            );
            entered = true;
            provider = wrapLanguageModel({
              model: makeProvider(key),
              middleware: [],
            });
          }
          await store.step({
            id: request.id,
            userId: options.userId,
            env: options.env,
            step,
            inputBytes,
            outputTokens,
            revisions: request.revisions,
          });
        },
        modelTerminal: (step) => store.stepTerminal(request.id, step),
        event: (event) => store.event(options.userId, request.id, event),
        readRevision: (input) =>
          store.readRevision(options.userId, request.revisions, input),
        ...(searchSelection && searchConfig
          ? {
              webSearch: async (input: { query: string }, callId: string) => {
                const current = resolveSearchConfig(options.env);
                if (
                  !current ||
                  JSON.stringify(current.snapshot) !==
                    JSON.stringify(searchConfig.snapshot)
                )
                  throw new AppError("search_price_changed", 409);
                const operationId = crypto.randomUUID();
                let searchReserved = false;
                let searchEntered = false;
                try {
                  await searchStore.reserve({
                    id: operationId,
                    runId: request.id,
                    callId,
                    userId: options.userId,
                    selection: searchSelection,
                    config: current,
                    digest: resourceDigest(
                      JSON.stringify({
                        runId: request.id,
                        callId,
                        query: input.query,
                        provider: "tavily",
                        credentialRevision: searchSelection.credentialRevision,
                        priceRevision: searchSelection.priceRevision,
                      }),
                      options.env,
                    ),
                    env: options.env,
                  });
                  searchReserved = true;
                  signal.throwIfAborted();
                  const key = await searchStore.enter({
                    id: operationId,
                    runId: request.id,
                    callId,
                    userId: options.userId,
                    selection: searchSelection,
                    snapshot: current.snapshot,
                    env: options.env,
                  });
                  searchEntered = true;
                  const evidence = searchEvidenceSchema.parse(
                    await (options.searchAdapter ?? runTavilySearch)({
                      key,
                      query: input.query,
                      signal,
                    }),
                  );
                  if (
                    wrappedToolResultBytes(evidence) >
                    SEARCH_LIMITS.contextBytes
                  )
                    throw new AppError("search_result_limit", 502);
                  await searchStore.finish(
                    operationId,
                    options.userId,
                    "terminal",
                    options.env,
                  );
                  return evidence;
                } catch (error) {
                  if (searchReserved)
                    await searchStore.finish(
                      operationId,
                      options.userId,
                      searchEntered ? "unknown" : "before_entry",
                      options.env,
                    );
                  throw error;
                }
              },
            }
          : {}),
      },
    });
    await store.finish(options.userId, request.id, "completed", result.answer);
    await byok.finish(request.id, options.userId, "terminal", options.env);
    return store.view(options.userId, request.id);
  } catch {
    await store.finish(
      options.userId,
      request.id,
      entered ? "failed" : "denied",
    );
    if (reserved)
      await byok.finish(
        request.id,
        options.userId,
        entered ? "unknown" : "before_entry",
        options.env,
      );
    throw new AppError(
      signal.aborted ? "tool_cancelled" : "tool_run_failed",
      signal.aborted ? 499 : 503,
    );
  }
}
