import {
  addMemories as addMemoriesFn,
  getMemories as getMemoriesFn,
  retrieveMemories as retrieveMemoriesFn,
} from "@mem0/vercel-ai-provider";

// Use any for now to avoid type conflicts between different ai package versions
type LanguageModelV1Prompt = any;

const mem0ApiKey = process.env.MEM0_API_KEY;

export async function addMemories(
  messages: LanguageModelV1Prompt,
  { user_id }: { user_id: string },
) {
  try {
    if (!mem0ApiKey) {
      console.warn("MEM0_API_KEY not set, skipping memory storage");
      return;
    }

    // Convert messages to the format Mem0 expects
    const mem0Messages = messages.map((msg: any) => ({
      role: msg.role,
      content: msg.content || [{ type: "text", text: "" }],
    }));

    await addMemoriesFn(mem0Messages, {
      user_id,
      mem0ApiKey,
    });
  } catch (error) {
    console.warn("Failed to add memories:", error);
  }
}

export async function retrieveMemories(
  prompt: string,
  { user_id }: { user_id: string },
): Promise<string> {
  try {
    if (!mem0ApiKey) {
      console.warn("MEM0_API_KEY not set, returning empty memories");
      return "";
    }

    const retrievedMemories = await retrieveMemoriesFn(prompt, {
      user_id,
      mem0ApiKey,
    });

    // Mem0 returns a string, so we can use it directly
    return retrievedMemories || "";
  } catch (error) {
    console.warn("Failed to retrieve memories:", error);
    return "";
  }
}

export async function getMemories({ user_id }: { user_id: string }) {
  try {
    if (!mem0ApiKey) {
      console.warn("MEM0_API_KEY not set, returning empty memories");
      return [];
    }

    return await getMemoriesFn("", { user_id, mem0ApiKey });
  } catch (error) {
    console.warn("Failed to get memories:", error);
    return [];
  }
}
