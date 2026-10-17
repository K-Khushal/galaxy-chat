export type ChatModel = {
  id: string;
  name: string;
  description?: string;
  available: boolean;
  type?: string;
  adapter?: "openrouter" | "gateway";
  capabilities?: {
    text: boolean;
    reasoning: boolean;
    sources: boolean;
    files: boolean;
    tools: boolean;
    search: boolean;
  };
};
