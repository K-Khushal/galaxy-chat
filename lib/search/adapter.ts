import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { wrappedToolResultBytes } from "@/lib/tools/result-envelope";
import {
  SEARCH_LIMITS,
  type SearchEvidence,
  type SearchSource,
  searchToolSchema,
} from "./contract";

export const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const responseSchema = z
  .object({
    query: z.string(),
    results: z
      .array(
        z
          .object({
            title: z.string(),
            url: z.string(),
            content: z.string(),
          })
          .passthrough(),
      )
      .max(SEARCH_LIMITS.results),
    usage: z.object({ credits: z.literal(1) }).strict(),
  })
  .passthrough();

function text(value: string, max: number) {
  return [...value.replace(/[\t\n\r]+/g, " ").replace(/[\p{Cc}\p{Cf}]/gu, "")]
    .slice(0, max)
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
}

function safeUrl(value: string) {
  if (value.length > SEARCH_LIMITS.urlCharacters) return;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return;
    url.hash = "";
    if (url.href.length > SEARCH_LIMITS.urlCharacters) return;
    return { url: url.href, hostname: url.hostname };
  } catch {
    return;
  }
}

function boundedEvidence(
  sources: Omit<SearchSource, "id">[],
  retrievedAt: string,
): SearchEvidence {
  const kept = sources.slice(0, SEARCH_LIMITS.results).map((source, index) => ({
    id: `S${index + 1}`,
    ...source,
  }));
  const result: SearchEvidence = {
    status: kept.length ? "results" : "no_results",
    retrievedAt,
    sources: kept,
    usageCredits: 1,
  };
  while (wrappedToolResultBytes(result) > SEARCH_LIMITS.contextBytes) {
    const last = result.sources.at(-1);
    if (!last) throw new AppError("search_result_limit", 502);
    if ([...last.snippet].length > 96)
      last.snippet = [...last.snippet].slice(0, -64).join("");
    else result.sources.pop();
  }
  result.sources.forEach((source, index) => {
    source.id = `S${index + 1}`;
  });
  result.status = result.sources.length ? "results" : "no_results";
  return result;
}

async function readBounded(response: Response) {
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > SEARCH_LIMITS.transportBytes) {
    await cancelBody(response);
    throw new AppError("search_response_limit", 502);
  }
  if (!response.body) throw new AppError("search_provider_failed", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > SEARCH_LIMITS.transportBytes) {
        await reader.cancel();
        throw new AppError("search_response_limit", 502);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function cancelBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    /* The response is already terminal; never retry or follow it. */
  }
}

export async function runTavilySearch(options: {
  key: string;
  query: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  now?: () => Date;
}): Promise<SearchEvidence> {
  const query = searchToolSchema.shape.query.parse(options.query);
  const signal = AbortSignal.any([
    AbortSignal.timeout(SEARCH_LIMITS.timeoutMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  signal.throwIfAborted();
  const body = {
    query,
    search_depth: "basic",
    chunks_per_source: 1,
    max_results: 5,
    topic: "general",
    include_answer: false,
    include_raw_content: false,
    include_images: false,
    include_image_descriptions: false,
    include_favicon: false,
    include_published_date: false,
    auto_parameters: false,
    include_usage: true,
    safe_search: true,
  } as const;
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(TAVILY_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      // Cloudflare Workers supports manual redirects and rejects the `error`
      // mode before dispatch. A 3xx is rejected explicitly below.
      redirect: "manual",
      signal,
    });
  } catch {
    throw new AppError("search_provider_failed", 502);
  }
  if (response.status >= 300 && response.status < 400) {
    await cancelBody(response);
    throw new AppError("search_provider_failed", 502);
  }
  if (!response.ok) {
    await cancelBody(response);
    throw new AppError("search_provider_failed", 502);
  }
  try {
    const parsed = responseSchema.parse(
      JSON.parse(await readBounded(response)),
    );
    if (parsed.query !== query)
      throw new AppError("search_provider_failed", 502);
    const seen = new Set<string>();
    const sources: Omit<SearchSource, "id">[] = [];
    for (const raw of parsed.results) {
      const safe = safeUrl(raw.url);
      if (!safe || seen.has(safe.url)) continue;
      seen.add(safe.url);
      sources.push({
        title: text(raw.title, SEARCH_LIMITS.titleCharacters),
        ...safe,
        snippet: text(raw.content, SEARCH_LIMITS.snippetCharacters),
      });
    }
    return boundedEvidence(
      sources,
      (options.now?.() ?? new Date()).toISOString(),
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("search_provider_failed", 502);
  }
}
