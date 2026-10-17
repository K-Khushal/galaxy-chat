import { AppError } from "@/lib/errors";
export async function boundedJson(
  request: Request,
  maximumBytes = 32_000,
): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximumBytes))
    throw new AppError("invalid_request", 413);
  if (!request.body) throw new AppError("invalid_request", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new AppError("invalid_request", 413);
      }
      chunks.push(part.value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("invalid_request", 400);
  } finally {
    reader.releaseLock();
  }
}
