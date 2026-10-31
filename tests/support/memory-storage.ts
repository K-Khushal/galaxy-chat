import {
  ObjectChangedError,
  type ObjectStorage,
} from "../../lib/attachments/storage";

type Stored = { bytes: Uint8Array; contentType: string; etag: string };

/** In-memory object storage: no network, with the browser's PUT simulated. */
export class MemoryStorage implements ObjectStorage {
  objects = new Map<string, Stored>();
  /** Every signed PUT: what the URL binds. */
  puts: { key: string; contentType: string; contentLength: number }[] = [];
  /** Every signed GET. */
  gets: { key: string; url: string; disposition: string }[] = [];
  failRemove = false;
  private writes = 0;

  async presignPut(
    key: string,
    options: { contentType: string; contentLength: number },
  ) {
    this.puts.push({ key, ...options });
    return `https://storage.test/put/${key}`;
  }

  async presignGet(
    key: string,
    options: { contentType: string; disposition: string },
  ) {
    const url = `https://storage.test/get/${key}?type=${encodeURIComponent(options.contentType)}`;
    this.gets.push({ key, url, disposition: options.disposition });
    return url;
  }

  async head(key: string) {
    const stored = this.objects.get(key);
    return stored
      ? {
          size: stored.bytes.length,
          contentType: stored.contentType,
          etag: stored.etag,
        }
      : null;
  }

  async read(
    key: string,
    range: { start: number; end: number },
    ifMatch?: string,
  ) {
    const stored = this.objects.get(key);
    if (!stored) throw new Error("no such object");
    if (ifMatch !== undefined && ifMatch !== stored.etag) {
      throw new ObjectChangedError();
    }
    return stored.bytes.slice(range.start, range.end + 1);
  }

  async remove(keys: string[]) {
    if (this.failRemove) throw new Error("storage unavailable");
    for (const key of keys) this.objects.delete(key);
  }

  /** What the browser does with the presigned URL. */
  upload(key: string, bytes: Uint8Array, contentType: string) {
    if (this.objects.has(key)) throw new ObjectChangedError();
    this.objects.set(key, { bytes, contentType, etag: `"${++this.writes}"` });
  }
}
