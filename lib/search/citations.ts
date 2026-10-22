import { AppError } from "@/lib/errors";
import type { SearchEvidence, SearchSource } from "./contract";

export function validateCitationPart(
  part: { sourceId: string; url: string },
  evidence: SearchEvidence,
) {
  const source = evidence.sources.find((item) => item.id === part.sourceId);
  if (!source || source.url !== part.url)
    throw new AppError("search_citation_invalid", 502);
  return source;
}

export function resolveCitations(answer: string, evidence?: SearchEvidence) {
  const ids = [...answer.matchAll(/\[\[(S\d+)\]\]/g)].map((match) => match[1]);
  const unique = [...new Set(ids)];
  const sources: SearchSource[] = [];
  for (const id of unique) {
    const source = evidence?.sources.find((item) => item.id === id);
    if (!source) throw new AppError("search_citation_invalid", 502);
    sources.push(source);
  }
  return { answer, sources };
}
