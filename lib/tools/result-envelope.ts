import "server-only";

export function untruncatedToolResult(value: unknown): string {
  return JSON.stringify({
    untrusted: true,
    content: JSON.stringify(value),
    truncated: false,
  });
}

export function wrappedToolResultBytes(value: unknown): number {
  return Buffer.byteLength(untruncatedToolResult(value));
}

export function boundedToolResult(value: unknown, maxBytes = 4096): string {
  let text = JSON.stringify(value);
  let result = JSON.stringify({
    untrusted: true,
    content: text,
    truncated: false,
  });
  if (Buffer.byteLength(result) <= maxBytes) return result;
  while (Buffer.byteLength(result) > maxBytes) {
    text = text.slice(0, Math.max(0, text.length - 128));
    result = JSON.stringify({
      untrusted: true,
      content: text,
      truncated: true,
    });
  }
  return result;
}
