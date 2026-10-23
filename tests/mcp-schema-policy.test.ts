import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { parseMcpSchema, parseMcpArguments, ownMcpArguments } = await import(
  "../lib/mcp/schema-policy"
);
const schema = {
  type: "object",
  properties: {
    message: { type: "string", minLength: 1, maxLength: 8 },
    count: { type: "integer", minimum: 0, maximum: 10 },
    flags: { type: "array", items: { type: "boolean" }, maxItems: 2 },
  },
  required: ["message"],
  additionalProperties: false,
};
test("bounded deterministic schema subset owns definitions and exact UTF8 arguments", () => {
  const raw = structuredClone(schema),
    parsed = parseMcpSchema(raw);
  raw.properties.message.maxLength = 100;
  expect(parsed.properties?.message.maxLength).toBe(8);
  const args = { message: "éé", count: 1, flags: [true] },
    value = parseMcpArguments(parsed, args);
  args.flags.push(false);
  expect(value).toEqual({ message: "éé", count: 1, flags: [true] });
  expect(Object.isFrozen(value.flags)).toBe(true);
  for (const invalid of [
    { message: "é".repeat(9) },
    { message: "", count: 1 },
    { message: "ok", extra: true },
    { message: "ok", count: 1.5 },
    { message: "ok", count: Infinity },
    { message: "ok", flags: [true, false, true] },
    { count: 1 },
    { message: 4 },
    { message: "ok", flags: [1] },
  ])
    expect(() => parseMcpArguments(parsed, invalid)).toThrow(
      "mcp_arguments_rejected",
    );
});
test("Unicode length semantics and independent UTF8 byte ceilings both apply", () => {
  const accepted = parseMcpSchema({
    type: "object",
    properties: { text: { type: "string", minLength: 2, maxLength: 1024 } },
    required: ["text"],
    additionalProperties: false,
  });
  expect(() => parseMcpArguments(accepted, { text: "é" })).toThrow(
    "mcp_arguments_rejected",
  );
  expect(parseMcpArguments(accepted, { text: "éé" })).toEqual({ text: "éé" });
  expect(() => parseMcpArguments(accepted, { text: "é".repeat(513) })).toThrow(
    "mcp_arguments_rejected",
  );
});
test("persisted strings reject unpaired UTF16 and NUL while preserving Unicode scalar values", () => {
  for (const text of [
    "\ud800",
    "\udfff",
    "x\ud800y",
    "\ud800\ud800",
    "\udfff\ud800",
    "\u0000",
  ]) {
    for (const raw of [
      { ...schema, description: text },
      {
        ...schema,
        properties: { message: { type: "string", maxLength: 8, enum: [text] } },
      },
      { ...schema, properties: { [text]: { type: "null" } }, required: [] },
    ])
      expect(() => parseMcpSchema(raw)).toThrow("mcp_schema_rejected");
    expect(() =>
      parseMcpArguments(parseMcpSchema(schema), { message: text }),
    ).toThrow("mcp_arguments_rejected");
    expect(() => ownMcpArguments({ message: text })).toThrow(
      "mcp_arguments_rejected",
    );
    expect(() => ownMcpArguments({ [text]: true })).toThrow(
      "mcp_arguments_rejected",
    );
  }
  const text = "हाय😀é";
  const accepted = parseMcpSchema({
    ...schema,
    description: text,
    properties: { message: { type: "string", maxLength: 8, enum: [text] } },
  });
  expect(accepted.description).toBe(text);
  expect(parseMcpArguments(accepted, { message: text })).toEqual({
    message: text,
  });
  expect(ownMcpArguments({ message: text })).toEqual({ message: text });
});
test("references, combinators, regexes, executable metadata and unbounded schema shapes are rejected", () => {
  for (const key of [
    "$ref",
    "$id",
    "$schema",
    "pattern",
    "allOf",
    "anyOf",
    "oneOf",
    "not",
    "format",
    "default",
    "examples",
    "x-execute",
  ])
    expect(() =>
      parseMcpSchema({ ...schema, [key]: "https://untrusted.example/schema" }),
    ).toThrow("mcp_schema_rejected");
  for (const value of [
    { type: "array", items: { type: "string", maxLength: 2 }, maxItems: 2 },
    { ...schema, additionalProperties: true },
    { ...schema, required: ["message", "message"] },
    { ...schema, required: ["missing"] },
    { ...schema, properties: { message: { type: "string" } } },
    {
      ...schema,
      properties: { n: { type: "number", minimum: NaN, maximum: 1 } },
    },
    {
      ...schema,
      properties: { s: { type: "string", maxLength: 3, enum: ["a", "a"] } },
    },
    { ...schema, description: "a".repeat(1025) },
    {
      ...schema,
      properties: {
        x: { type: "array", items: { type: "null" }, maxItems: 17 },
      },
    },
  ])
    expect(() => parseMcpSchema(value)).toThrow("mcp_schema_rejected");
  let deep: unknown = { type: "null" };
  for (let i = 0; i < 7; i++)
    deep = {
      type: "object",
      properties: { child: deep },
      additionalProperties: false,
    };
  expect(() => parseMcpSchema(deep)).toThrow("mcp_schema_rejected");
  expect(() =>
    parseMcpSchema(
      JSON.parse(
        '{"type":"object","properties":{"__proto__":{"type":"null"}},"additionalProperties":false}',
      ),
    ),
  ).toThrow("mcp_schema_rejected");
});
test("untrusted argument ownership bounds cycles, scalar roots, bytes, arrays and nonJSON values before awaits", () => {
  const cycle: Record<string, unknown> = {};
  cycle.child = cycle;
  for (const raw of [
    cycle,
    null,
    [],
    { value: undefined },
    { value: BigInt(1) },
    { value: () => true },
    { value: NaN },
    { value: "a".repeat(1025) },
    { values: Array.from({ length: 17 }, () => true) },
    {
      a: "a".repeat(1024),
      b: "b".repeat(1024),
      c: "c".repeat(1024),
      d: "d".repeat(1024),
    },
  ])
    expect(() => ownMcpArguments(raw)).toThrow("mcp_arguments_rejected");
  const raw = { value: [1, true, null] },
    owned = ownMcpArguments(raw);
  raw.value[0] = 2;
  expect(owned).toEqual({ value: [1, true, null] });
  expect(Object.isFrozen(owned.value)).toBe(true);
});
test("independent schema node, property and byte bounds reject otherwise supported definitions", () => {
  const propertyOverflow = Object.fromEntries(
    Array.from({ length: 17 }, (_, i) => [`p${i}`, { type: "boolean" }]),
  );
  const nodeOverflow = Object.fromEntries(
    Array.from({ length: 16 }, (_, i) => [
      `p${i}`,
      {
        type: "object",
        properties: {
          a: { type: "boolean" },
          b: { type: "boolean" },
          c: { type: "boolean" },
          d: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ]),
  );
  const byteOverflow = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [
      `p${i}`,
      { type: "string", maxLength: 1, description: "a".repeat(1024) },
    ]),
  );
  for (const properties of [propertyOverflow, nodeOverflow, byteOverflow])
    expect(() =>
      parseMcpSchema({
        type: "object",
        properties,
        additionalProperties: false,
      }),
    ).toThrow("mcp_schema_rejected");
  expect(() => ownMcpArguments({ ["a".repeat(1000)]: true })).toThrow(
    "mcp_arguments_rejected",
  );
});
