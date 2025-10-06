export type ChatModel = {
  id: string;
  name: string;
  description?: string;
  available: boolean;
  type?: string;
};

export const chatModels: ChatModel[] = [
  {
    id: "google/gemini-2.0-flash-lite",
    name: "Gemini 2.0 Flash Lite",
    available: true,
    type: "chat-model",
  },
  {
    id: "openai/gpt-5-nano",
    name: "GPT-5 Nano",
    available: true,
    type: "chat-model",
  },
];
