export type ChatModel = {
  id: string;
  name: string;
  description?: string;
  available: boolean;
};

export const chatModels: ChatModel[] = [
  {
    id: "x-ai/grok-4-fast:free",
    name: "Grok 4 Fast",
    available: false,
  },
  {
    id: "deepseek/deepseek-r1:free",
    name: "Deepseek R1",
    available: true,
  },
  {
    id: "openai/gpt-oss-120b:free",
    name: "GPT OSS 120B",
    available: true,
  },
  {
    id: "google/gemini-2.0-flash-exp:free",
    name: "Gemini 2.0 Flash Exp",
    available: true,
  },
  {
    id: "z-ai/glm-4.5-air:free",
    name: "Z AI GLM 4.5 Air",
    available: true,
  },
  {
    id: "mistralai/mistral-small-3.2-24b-instruct:free",
    name: "Mistral Small",
    available: true,
  },
];
