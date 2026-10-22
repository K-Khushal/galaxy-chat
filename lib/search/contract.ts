import { z } from "zod";

export const SEARCH_LIMITS = {
  queryCharacters: 256,
  results: 5,
  timeoutMs: 10_000,
  transportBytes: 65_536,
  contextBytes: 4096,
  titleCharacters: 160,
  urlCharacters: 1024,
  snippetCharacters: 700,
} as const;

export const searchSelection = z
  .object({
    provider: z.literal("tavily"),
    query: z.string().trim().min(1).max(SEARCH_LIMITS.queryCharacters),
    credentialRevision: z.uuid(),
    priceRevision: z.string().min(1).max(100),
    estimateMicrodollars: z.number().int().positive().max(2_000_000_000),
    ceilingMicrodollars: z.number().int().positive().max(2_000_000_000),
    providerBudgetAcknowledged: z.literal(true),
    querySharingAcknowledged: z.literal(true),
  })
  .strict();

export const searchToolSchema = z
  .object({
    query: z.string().trim().min(1).max(SEARCH_LIMITS.queryCharacters),
  })
  .strict();

const searchSourceSchema = z
  .object({
    id: z.string().regex(/^S[1-5]$/),
    title: z.string().max(SEARCH_LIMITS.titleCharacters),
    url: z.string().max(SEARCH_LIMITS.urlCharacters),
    hostname: z.string().min(1).max(253),
    snippet: z.string().max(SEARCH_LIMITS.snippetCharacters),
  })
  .strict()
  .superRefine((source, context) => {
    try {
      const url = new URL(source.url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hostname !== source.hostname
      )
        context.addIssue({ code: "custom", message: "unsafe source URL" });
    } catch {
      context.addIssue({ code: "custom", message: "invalid source URL" });
    }
  });

export const searchEvidenceSchema = z
  .object({
    status: z.enum(["results", "no_results"]),
    retrievedAt: z.iso.datetime(),
    sources: z.array(searchSourceSchema).max(SEARCH_LIMITS.results),
    usageCredits: z.literal(1),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (
      (evidence.status === "results") !== evidence.sources.length > 0 ||
      evidence.sources.some((source, index) => source.id !== `S${index + 1}`) ||
      new Set(evidence.sources.map((source) => source.url)).size !==
        evidence.sources.length
    )
      context.addIssue({ code: "custom", message: "invalid search evidence" });
  });

export type SearchSelection = z.infer<typeof searchSelection>;
export type SearchSource = {
  id: string;
  title: string;
  url: string;
  hostname: string;
  snippet: string;
};
export type SearchEvidence = z.infer<typeof searchEvidenceSchema>;
export type SearchRunState = {
  status: "not_used" | "results" | "no_results" | "provider_error";
  retrievedAt?: string;
  sources: SearchSource[];
};
export type SearchCredentialView = {
  provider: "tavily";
  maskedKey: string;
  revision: string;
};
export type SearchCredentialState = {
  configured: boolean;
  credentials: SearchCredentialView[];
};
