import { generateText, type UIMessage } from "ai";

export async function generateChatTitle({ message }: { message: UIMessage }) {
  const { text: title } = await generateText({
    model: "meituan/longcat-flash-chat",
    system: `\n
      - you will generate a short title based on the first message a user begins a conversation with
      - ensure it is not more than 80 characters long
      - the title should be a summary of the user's message
      - do not use single quotes double quotes or colons`,
    prompt: JSON.stringify(message),
  });

  return title;
}
