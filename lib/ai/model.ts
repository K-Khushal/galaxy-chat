export type ChatModel = {
  id: string;
  name: string;
  description?: string;
  available: boolean;
  type: string;
};

export const chatModels: ChatModel[] = [
  {
    id: "meta/llama-3.2-1b",
    name: "Llama 3.2 1B",
    available: true,
    type: "chat-model",
  },
  {
    id: "deepseek/deepseek-r1:free",
    name: "Deepseek R1",
    available: true,
    type: "chat-model",
  },
  {
    id: "openai/gpt-oss-120b:free",
    name: "GPT OSS 120B",
    available: false,
    type: "chat-model",
  },
  {
    id: "google/gemini-2.0-flash-exp:free",
    name: "Gemini 2.0 Flash Exp",
    available: true,
    type: "chat-model",
  },
  {
    id: "z-ai/glm-4.5-air:free",
    name: "Z AI GLM 4.5 Air",
    available: true,
    type: "chat-model",
  },
  {
    id: "mistralai/mistral-small-3.2-24b-instruct:free",
    name: "Mistral Small",
    available: true,
    type: "chat-model",
  },
];
