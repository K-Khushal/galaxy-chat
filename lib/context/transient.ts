import type { TypeUIMessage } from "@/lib/types";
/** Never reads storage: only text from the current component's preceding turns. */
export function temporaryHistory(
  messages: TypeUIMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .slice(0, -1)
    .flatMap((message) =>
      message.role === "user" || message.role === "assistant"
        ? [
            {
              role: message.role,
              content: message.parts
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("\n"),
            },
          ]
        : [],
    )
    .slice(-11);
}
