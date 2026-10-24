import "server-only";
import { AppError } from "@/lib/errors";
import { canonicalJson, deepFreeze } from "@/lib/funding/config";

export const MCP_SCHEMA_LIMITS = Object.freeze({
  bytes: 8192,
  argumentBytes: 4096,
  depth: 5,
  nodes: 64,
  properties: 16,
  arrayItems: 16,
  stringBytes: 1024,
  validationOperations: 2048,
});
export type McpSchema = Readonly<{
  type:
    | "object"
    | "array"
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "null";
  description?: string;
  properties?: Readonly<Record<string, McpSchema>>;
  required?: readonly string[];
  additionalProperties?: false;
  items?: McpSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
}>;
function fail(): never {
  throw new AppError("mcp_schema_rejected", 400);
}
function object(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail();
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    fail();
  return value;
}
export function mcpText(raw: unknown, max: number): string {
  if (
    typeof raw !== "string" ||
    raw.length > max ||
    Buffer.byteLength(raw, "utf8") > max ||
    [...raw].some((character) => {
      const code = character.charCodeAt(0);
      return (
        (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
        code === 127 ||
        (character.length === 1 && code >= 0xd800 && code <= 0xdfff)
      );
    })
  )
    fail();
  return raw;
}
/** A deliberately small, local JSONSchema subset. No references, regexes or executable extensions. */
export function parseMcpSchema(raw: unknown, rootObject = true): McpSchema {
  let nodes = 0;
  function walk(value: unknown, depth: number): McpSchema {
    if (depth > MCP_SCHEMA_LIMITS.depth || ++nodes > MCP_SCHEMA_LIMITS.nodes)
      fail();
    const input = object(value),
      type = input.type;
    const output: Record<string, unknown> = { type };
    const allowed = new Set(["type", "description"]);
    if (input.description !== undefined)
      output.description = mcpText(input.description, 1024);
    if (type === "object") {
      for (const name of ["properties", "required", "additionalProperties"])
        allowed.add(name);
      if (input.additionalProperties !== false) fail();
      const props = object(input.properties);
      const names = Object.keys(props);
      if (names.length > MCP_SCHEMA_LIMITS.properties) fail();
      const parsed: Record<string, McpSchema> = {};
      for (const name of names) {
        if (
          !/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(name) ||
          ["__proto__", "prototype", "constructor"].includes(name)
        )
          fail();
        parsed[name] = walk(props[name], depth + 1);
      }
      const required = input.required ?? [];
      if (
        !Array.isArray(required) ||
        required.length > names.length ||
        required.some(
          (name) => typeof name !== "string" || !names.includes(name),
        ) ||
        new Set(required).size !== required.length
      )
        fail();
      Object.assign(output, {
        properties: parsed,
        required: [...required].sort(),
        additionalProperties: false,
      });
    } else if (type === "array") {
      for (const name of ["items", "minItems", "maxItems"]) allowed.add(name);
      const maxItems = integer(input.maxItems, 0, MCP_SCHEMA_LIMITS.arrayItems);
      Object.assign(output, {
        items: walk(input.items, depth + 1),
        minItems: integer(input.minItems ?? 0, 0, maxItems),
        maxItems,
      });
    } else if (type === "string") {
      for (const name of ["minLength", "maxLength", "enum"]) allowed.add(name);
      const maxLength = integer(
        input.maxLength,
        0,
        MCP_SCHEMA_LIMITS.stringBytes,
      );
      Object.assign(output, {
        minLength: integer(input.minLength ?? 0, 0, maxLength),
        maxLength,
      });
      if (input.enum !== undefined) {
        if (
          !Array.isArray(input.enum) ||
          !input.enum.length ||
          input.enum.length > 16
        )
          fail();
        const values = input.enum.map((value) =>
          mcpText(value, MCP_SCHEMA_LIMITS.stringBytes),
        );
        if (
          new Set(values).size !== values.length ||
          values.some(
            (value) =>
              [...value].length < Number(output.minLength) ||
              [...value].length > maxLength,
          )
        )
          fail();
        output.enum = values.sort();
      }
    } else if (type === "number" || type === "integer") {
      allowed.add("minimum");
      allowed.add("maximum");
      const { minimum, maximum } = input;
      if (
        typeof minimum !== "number" ||
        typeof maximum !== "number" ||
        !Number.isFinite(minimum) ||
        !Number.isFinite(maximum) ||
        minimum < -1e12 ||
        maximum > 1e12 ||
        minimum > maximum ||
        (type === "integer" &&
          (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum)))
      )
        fail();
      Object.assign(output, { minimum, maximum });
    } else if (type !== "boolean" && type !== "null") fail();
    if (Object.keys(input).some((key) => !allowed.has(key))) fail();
    return output as McpSchema;
  }
  try {
    const result = walk(raw, 0);
    if (
      (rootObject && result.type !== "object") ||
      Buffer.byteLength(canonicalJson(result)) > MCP_SCHEMA_LIMITS.bytes
    )
      fail();
    return deepFreeze(result);
  } catch {
    return fail();
  }
}
/** Own and freeze the complete validated argument object before any asynchronous work. */
export function parseMcpArguments(
  schema: McpSchema,
  raw: unknown,
): Readonly<Record<string, unknown>> {
  let operations = 0;
  const accepted = parseMcpSchema(schema);
  function walk(node: McpSchema, value: unknown): unknown {
    if (++operations > MCP_SCHEMA_LIMITS.validationOperations) fail();
    if (node.type === "object") {
      const input = object(value),
        output: Record<string, unknown> = {};
      const properties = node.properties ?? {};
      if (
        Object.keys(input).some((key) => !Object.hasOwn(properties, key)) ||
        node.required?.some((key) => !Object.hasOwn(input, key))
      )
        fail();
      for (const [key, item] of Object.entries(input))
        output[key] = walk(properties[key], item);
      return output;
    }
    if (node.type === "array") {
      if (
        !Array.isArray(value) ||
        value.length < Number(node.minItems) ||
        value.length > Number(node.maxItems) ||
        !node.items
      )
        fail();
      const items = node.items;
      return value.map((item) => walk(items, item));
    }
    if (node.type === "string") {
      const result = mcpText(value, MCP_SCHEMA_LIMITS.stringBytes),
        length = [...result].length;
      if (
        length < Number(node.minLength) ||
        length > Number(node.maxLength) ||
        (node.enum && !node.enum.includes(result))
      )
        fail();
      return result;
    }
    if (node.type === "number" || node.type === "integer") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < Number(node.minimum) ||
        value > Number(node.maximum) ||
        (node.type === "integer" && !Number.isSafeInteger(value))
      )
        fail();
      return Object.is(value, -0) ? 0 : value;
    }
    if (node.type === "boolean" ? typeof value !== "boolean" : value !== null)
      fail();
    return value;
  }
  try {
    const result = object(walk(accepted, raw));
    if (
      Buffer.byteLength(canonicalJson(result)) > MCP_SCHEMA_LIMITS.argumentBytes
    )
      fail();
    return deepFreeze(result);
  } catch {
    throw new AppError("mcp_arguments_rejected", 400);
  }
}

/** Bound and detach untrusted JSON before awaiting the owned schema lookup. */
export function ownMcpArguments(
  raw: unknown,
): Readonly<Record<string, unknown>> {
  let operations = 0;
  function walk(value: unknown, depth: number): unknown {
    if (
      depth > MCP_SCHEMA_LIMITS.depth ||
      ++operations > MCP_SCHEMA_LIMITS.validationOperations
    )
      fail();
    if (typeof value === "string")
      return mcpText(value, MCP_SCHEMA_LIMITS.stringBytes);
    if (value === null || typeof value === "boolean") return value;
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      Math.abs(value) <= 1e12
    )
      return value;
    if (Array.isArray(value)) {
      if (value.length > MCP_SCHEMA_LIMITS.arrayItems) fail();
      return value.map((item) => walk(item, depth + 1));
    }
    const input = object(value),
      output: Record<string, unknown> = {};
    if (Object.keys(input).length > MCP_SCHEMA_LIMITS.properties) fail();
    for (const [key, item] of Object.entries(input)) {
      if (
        !/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(key) ||
        ["__proto__", "constructor", "prototype"].includes(key)
      )
        fail();
      output[key] = walk(item, depth + 1);
    }
    return output;
  }
  try {
    const result = object(walk(raw, 0));
    if (
      Buffer.byteLength(canonicalJson(result)) > MCP_SCHEMA_LIMITS.argumentBytes
    )
      fail();
    return deepFreeze(result);
  } catch {
    throw new AppError("mcp_arguments_rejected", 400);
  }
}
