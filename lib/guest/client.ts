import { DefaultChatTransport, readUIMessageStream } from "ai";
import {
  GUEST_OUTPUT_LIMIT,
  type GuestView,
  guestViewSchema,
} from "./contract";
export type GuestClient = {
  status: (signal: AbortSignal) => Promise<GuestView>;
  generate: (
    input: { requestId: string; text: string; botToken: string },
    signal: AbortSignal,
    onText: (text: string) => void,
  ) => Promise<void>;
};
export function createGuestClient(
  fetcher: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response> = (...args) => fetch(...args),
): GuestClient {
  return {
    async status(signal) {
      const response = await fetcher("/api/guest", {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      });
      if (!response.ok) throw new Error("guest_unavailable");
      return guestViewSchema.parse(await response.json());
    },
    async generate(input, signal, onText) {
      const transport = new DefaultChatTransport({
        api: "/api/guest",
        credentials: "same-origin",
        prepareSendMessagesRequest: () => ({ body: input }),
        fetch: Object.assign(
          async (...args: Parameters<typeof fetch>) => {
            const response = await fetcher(...args);
            if (!response.ok) {
              let id = "guest_failed";
              try {
                const body = await response.json();
                if (
                  typeof body.error?.id === "string" &&
                  /^[a-z_]{1,80}$/.test(body.error.id)
                )
                  id = body.error.id;
              } catch {}
              throw new Error(id);
            }
            return response;
          },
          { preconnect: fetch.preconnect },
        ),
      });
      let finished = false;
      let textSize = 0;
      const bounded = new AbortController();
      const stream = (
        await transport.sendMessages({
          trigger: "submit-message",
          chatId: input.requestId,
          messageId: undefined,
          messages: [],
          abortSignal: AbortSignal.any([signal, bounded.signal]),
        })
      ).pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            if (chunk.type === "finish")
              finished =
                chunk.finishReason === "stop" ||
                chunk.finishReason === "length";
            if (chunk.type === "error") throw new Error("provider_failed");
            if (chunk.type === "text-delta") {
              textSize += chunk.delta.length;
              if (textSize > GUEST_OUTPUT_LIMIT) {
                bounded.abort();
                throw new Error("guest_output_limit");
              }
            }
            controller.enqueue(chunk);
          },
        }),
      );
      for await (const message of readUIMessageStream({
        stream,
        terminateOnError: true,
      })) {
        const text = message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
        onText(text);
      }
      if (!finished) throw new Error("provider_failed");
    },
  };
}
