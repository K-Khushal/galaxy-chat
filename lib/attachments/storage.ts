import "server-only";
import { readBounded } from "@/lib/attachments/content";
import { attachmentLimits } from "@/lib/attachments/contract";
import { AppError } from "@/lib/errors";
import type { PrivateStorageConfig } from "@/lib/storage/private";
export interface AttachmentStorage {
  assertPrivate(signal?: AbortSignal): Promise<void>;
  upload(key: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void>;
  download(
    key: string,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
  remove(key: string, signal?: AbortSignal): Promise<void>;
}
/** REST adapter deliberately accepts object keys only, never caller-provided URLs. */
export class SupabaseAttachmentStorage implements AttachmentStorage {
  private origin: string;
  constructor(
    private config: PrivateStorageConfig,
    private network: typeof fetch = fetch,
  ) {
    let url: URL;
    try {
      url = new URL(config.url);
    } catch {
      throw new AppError("storage_unconfigured", 503);
    }
    if (
      url.protocol !== "https:" ||
      !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
      url.pathname !== "/" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(config.bucket)
    )
      throw new AppError("storage_unconfigured", 503);
    this.origin = url.origin;
  }
  private path(key: string) {
    if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9-]+$/.test(key))
      throw new AppError("invalid_object", 400);
    return `${encodeURIComponent(this.config.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  private async call(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ) {
    const response = await this.network(`${this.origin}/storage/v1/${path}`, {
      ...init,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.any([
        AbortSignal.timeout(20_000),
        ...(signal ? [signal] : []),
      ]),
      headers: {
        apikey: this.config.secretKey,
        Authorization: `Bearer ${this.config.secretKey}`,
        ...init.headers,
      },
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new AppError("storage_redirect_denied", 503);
    }
    return response;
  }
  async assertPrivate(signal?: AbortSignal) {
    const response = await this.call(
      `bucket/${encodeURIComponent(this.config.bucket)}`,
      {},
      signal,
    );
    if (!response.ok) throw new AppError("storage_unavailable", 503);
    const bytes = await readBounded(response.body, 16_384, signal);
    let bucket: unknown;
    try {
      bucket = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new AppError("storage_unavailable", 503);
    }
    if (
      !bucket ||
      typeof bucket !== "object" ||
      !("public" in bucket) ||
      bucket.public !== false ||
      !("id" in bucket) ||
      bucket.id !== this.config.bucket
    )
      throw new AppError("storage_private_required", 503);
  }
  async upload(key: string, bytes: Uint8Array, signal?: AbortSignal) {
    const response = await this.call(
      `object/${this.path(key)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "cache-control": "max-age=0",
          "x-upsert": "false",
        },
        body: new Uint8Array(bytes).buffer,
      },
      signal,
    );
    if (!response.ok) throw new AppError("storage_upload_failed", 503);
    await response.body?.cancel();
  }
  async download(key: string, maxBytes: number, signal?: AbortSignal) {
    const path = this.path(key);
    const signed = await this.call(
      `object/sign/${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: attachmentLimits.signedSeconds }),
      },
      signal,
    );
    if (!signed.ok) throw new AppError("storage_download_failed", 503);
    const payload: unknown = JSON.parse(
      new TextDecoder().decode(await readBounded(signed.body, 16_384, signal)),
    );
    if (
      !payload ||
      typeof payload !== "object" ||
      !("signedURL" in payload) ||
      typeof payload.signedURL !== "string"
    )
      throw new AppError("storage_download_failed", 503);
    // The signed URL stays inside the server; each external read is authorized/budgeted.
    const url = new URL(`${this.origin}/storage/v1${payload.signedURL}`);
    if (
      url.origin !== this.origin ||
      url.pathname !== `/storage/v1/object/sign/${path}` ||
      !url.searchParams.get("token")
    )
      throw new AppError("storage_download_failed", 503);
    const response = await this.network(url, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.any([
        AbortSignal.timeout(20_000),
        ...(signal ? [signal] : []),
      ]),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new AppError("storage_redirect_denied", 503);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError("storage_download_failed", 503);
    }
    return readBounded(response.body, maxBytes, signal);
  }
  async remove(key: string, signal?: AbortSignal) {
    this.path(key);
    const response = await this.call(
      `object/${encodeURIComponent(this.config.bucket)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [key] }),
      },
      signal,
    );
    if (!response.ok && response.status !== 404)
      throw new AppError("storage_delete_failed", 503);
    await response.body?.cancel();
  }
}
