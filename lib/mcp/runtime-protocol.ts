import "server-only";
import { validateJSONRPCMessage } from "@ai-sdk/mcp";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { canonicalJson, deepFreeze } from "@/lib/funding/config";
import { type FrameKind, RUNTIME_PROTOCOL } from "./runtime-config";
import { type McpSchema, mcpText, parseMcpArguments } from "./schema-policy";
export function runtimeFrames(
  tool: string,
  args: Readonly<Record<string, unknown>>,
  ids: { initialize: string; call: string },
) {
  return deepFreeze({
    initialize: {
      jsonrpc: "2.0",
      id: ids.initialize,
      method: "initialize",
      params: {
        protocolVersion: RUNTIME_PROTOCOL,
        capabilities: {},
        clientInfo: { name: "galaxy-chat", version: "1" },
      },
    },
    initialized: { jsonrpc: "2.0", method: "notifications/initialized" },
    call: {
      jsonrpc: "2.0",
      id: ids.call,
      method: "tools/call",
      params: { name: tool, arguments: args },
    },
  });
}
const initResult = z
  .object({
    protocolVersion: z.literal(RUNTIME_PROTOCOL),
    capabilities: z
      .object({
        tools: z.object({ listChanged: z.literal(false).optional() }).strict(),
      })
      .strict(),
    serverInfo: z
      .object({ name: z.string().max(128), version: z.string().max(128) })
      .strict(),
  })
  .strict();
const callResult = z
  .object({
    content: z
      .array(
        z
          .object({ type: z.literal("text"), text: z.string().max(4096) })
          .strict(),
      )
      .max(16),
    structuredContent: z.record(z.string(), z.unknown()).optional(),
    isError: z.literal(false).optional(),
  })
  .strict();
/** A deliberately synchronous stateless subset. Server requests never trigger replies. */
export function parseRuntimeResult(
  kind: FrameKind,
  body: Uint8Array,
  status: number,
  requestBody: unknown,
  output: McpSchema | null,
) {
  try {
    if (kind === "initialized") {
      if (![202, 204].includes(status) || body.byteLength !== 0)
        throw new Error();
      return null;
    }
    if (status !== 200 || body.byteLength > 4096) throw new Error();
    const raw = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    );
    validateJSONRPCMessage(raw);
    const frame = z
      .object({
        jsonrpc: z.literal("2.0"),
        id: z.string(),
        result: z.unknown(),
      })
      .strict()
      .parse(raw);
    const request = z
      .object({ id: z.string() })
      .passthrough()
      .parse(requestBody);
    if (frame.id !== request.id) throw new Error();
    if (kind === "initialize") {
      const r = initResult.parse(frame.result);
      mcpText(r.serverInfo.name, 128);
      mcpText(r.serverInfo.version, 128);
      return deepFreeze(r);
    }
    const r = callResult.parse(frame.result);
    for (const c of r.content) mcpText(c.text, 4096);
    if (output) {
      if (!r.structuredContent) throw new Error();
      parseMcpArguments(output, r.structuredContent);
    } else if (r.structuredContent !== undefined) throw new Error();
    if (Buffer.byteLength(canonicalJson(r)) > 4096) throw new Error();
    return deepFreeze(r);
  } catch {
    throw new AppError("mcp_runtime_protocol_rejected", 502);
  }
}
