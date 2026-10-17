import type { Chat, TypeUIMessage, TypeUserProfile } from "@/lib/types";
export const previewScenarios = [
  "empty",
  "populated",
  "branches",
  "byok",
  "loading",
  "streaming",
  "error",
  "long",
  "history-loading",
  "history-error",
  "sign-in",
  "unconfigured",
] as const;
export type PreviewScenario = (typeof previewScenarios)[number];
export function isPreviewScenario(value: string): value is PreviewScenario {
  return previewScenarios.some((scenario) => scenario === value);
}
export const previewUser: TypeUserProfile = {
  userId: "preview-only",
  name: "Alex Morgan",
  email: "alex@example.test",
};
const titles = [
  "A better way to cache responses",
  "Notes for the next release",
  "A very long conversation title that should truncate gracefully without hiding the actions beside it",
  "Review an API design",
  "An idea for a small weekend project",
  "Understanding event streams",
  "A quieter morning routine",
  "Naming things is still hard",
  "日本語の会話 · A conversation in another language",
  "What makes a good interface?",
  "Planning a database migration",
  "Quick question about CSS",
  "A reading list for October",
  "Refining a project brief",
  "Debugging a tricky race condition",
  "More ideas from yesterday",
  "A conversation on the second page",
  "One final thing to explore",
];
export function fixtureHistory(): Chat[] {
  return titles.map((title, index) => ({
    id: `fixture-${index}`,
    title,
    userId: "preview-only",
    visibility: "private",
    lastContext: null,
    createdAt: new Date("2026-10-17T08:00:00Z"),
    updatedAt: new Date("2026-10-17T08:00:00Z"),
  }));
}
export const fixtureMessages: TypeUIMessage[] = [
  {
    id: "fixture-user",
    role: "user",
    parts: [
      {
        type: "text",
        text: "How would you design a small, reliable cache for API responses?",
      },
    ],
  },
  {
    id: "fixture-assistant",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "This is a **UI fixture**, written for layout review. No model generated this response.\n\nStart with a bounded cache and an explicit expiration policy. Keep the public interface small:\n\n```ts\ntype CacheEntry<T> = { value: T; expiresAt: number };\n\nfunction isFresh<T>(entry: CacheEntry<T>, now: number) {\n  return now < entry.expiresAt;\n}\n```\n\nThree decisions make the behavior predictable:\n\n1. **Set a size limit.** Evict the least recently used entry when the cache fills.\n2. **Keep failures out.** A transient network error should not become a cached result.\n3. **Make time explicit.** Passing a clock makes expiration easier to test.\n\nWould you keep this cache in one process, or share it across instances?".replaceAll(
          "\\n",
          "\n",
        ),
      },
    ],
  },
];
export const longMessages: TypeUIMessage[] = [
  ...fixtureMessages,
  {
    id: "fixture-long-user",
    role: "user",
    parts: [
      {
        type: "text",
        text: "Show a wide table, a long code line, and text that has no natural wrapping point.",
      },
    ],
  },
  {
    id: "fixture-long",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: [
          "Fixture content for overflow testing.",
          "| Component | Responsibility | Failure behavior |",
          "| --- | --- | --- |",
          "| A deliberately very long component name | Keep this table inside the message scroller | Report the failure and preserve the draft |",
          "",
          "```ts",
          'const longConfiguration = { endpoint: "https://example.test/a/very/long/path/that/should/stay/inside/the/code/block/and/scroll/horizontally/without/widening/the/conversation", retries: 3 };',
          "```",
          "",
          `Unbroken identifier: ${"galaxy_response_identifier_".repeat(16)}`,
          "",
          ...Array.from(
            { length: 12 },
            (_, i) =>
              `### Section ${i + 1}\n\nThis static fixture paragraph helps check scroll anchoring and content selection. Reading older content should never pull the reader back to the latest response.`,
          ),
        ].join("\n"),
      },
    ],
  },
];
