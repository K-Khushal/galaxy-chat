import "server-only";
import { createHash } from "node:crypto";
import {
  type AttachmentConfig,
  attachmentConfig,
} from "@/lib/attachments/config";
import {
  type AttachmentStorage,
  SupabaseAttachmentStorage,
} from "@/lib/attachments/storage";
import type { EnvSource } from "@/lib/auth/env";
import { ByokStore } from "@/lib/byok/store";
import { AppError } from "@/lib/errors";
import { type ImageAdapter, OpenRouterImageAdapter } from "./adapter";
import { imageSnapshot, validateImageReview } from "./config";
import { type ImageCatalog, imageLimits, imageRequest } from "./contract";
import { inspectPng } from "./png";
import { ImageStore } from "./store";
export class ImageService {
  constructor(
    readonly store = new ImageStore(),
    private readonly config: () => AttachmentConfig = attachmentConfig,
    private readonly storage?: AttachmentStorage,
    private readonly adapter: ImageAdapter = new OpenRouterImageAdapter(),
    private readonly env: EnvSource = process.env,
    private readonly byok = new ByokStore(store.db),
  ) {}
  async catalog(userId: string): Promise<ImageCatalog> {
    try {
      const model = imageSnapshot(this.env);
      this.config();
      const key = (await this.byok.credentials(userId)).find(
        (k) => k.provider === "openrouter" && k.testState !== "invalid",
      );
      return {
        available: true,
        model,
        credentialRevision: key?.revision,
        recent: await this.store.recent(userId),
      };
    } catch {
      return { available: false, reason: "images_unavailable" };
    }
  }
  async generate(userId: string, raw: unknown, requestSignal: AbortSignal) {
    const parsed = imageRequest.safeParse(raw);
    if (!parsed.success) throw new AppError("invalid_image_request", 400);
    const input = parsed.data,
      model = imageSnapshot(this.env),
      config = this.config();
    validateImageReview(input, model);
    const signal = AbortSignal.any([
      requestSignal,
      AbortSignal.timeout(imageLimits.milliseconds),
    ]);
    signal.throwIfAborted();
    const storage =
      this.storage ?? new SupabaseAttachmentStorage(config.storage);
    await storage.assertPrivate(signal);
    const object = await this.store.reserve(
      userId,
      input,
      model,
      config,
      this.env,
    );
    let entered = false;
    try {
      signal.throwIfAborted();
      const key = await this.byok.enter(
        input.requestId,
        userId,
        this.env,
        async (tx) => {
          await this.store.enter(
            tx,
            userId,
            input.requestId,
            () => {
              const fresh = this.config();
              if (
                fresh.storage.url !== config.storage.url ||
                fresh.storage.bucket !== config.storage.bucket ||
                fresh.storage.secretKey !== config.storage.secretKey
              )
                throw new AppError("image_review_changed", 409);
              return fresh;
            },
            this.env,
          );
          signal.throwIfAborted();
        },
      );
      entered = true;
      signal.throwIfAborted();
      const result = await this.adapter.generate({
        key,
        prompt: input.prompt,
        model,
        signal,
      });
      signal.throwIfAborted();
      // No remote bytes or URLs are persisted before canonicalization succeeds.
      const upload = await this.store.enterUpload(userId, input.requestId);
      signal.throwIfAborted();
      await storage.upload(upload.object_key, result.bytes, signal);
      await this.store.uploadTerminal(upload.object_key);
      signal.throwIfAborted();
      const saved = await this.store.complete(userId, input.requestId, result);
      return saved;
    } catch {
      await this.store.fail(userId, input.requestId, entered);
      await this.byok.finish(
        input.requestId,
        userId,
        entered ? "unknown" : "before_entry",
        this.env,
      );
      throw new AppError(
        entered
          ? "image_held"
          : signal.aborted
            ? "image_cancelled"
            : "image_review_changed",
        409,
      );
    } finally {
      // Object keys never appear in logs or client responses.
      void object;
    }
  }
  async cancel(userId: string, id: string) {
    return this.store.cancel(userId, id, this.env);
  }
  async status(userId: string, id: string) {
    return this.store.status(userId, id);
  }
  async download(
    userId: string,
    id: string,
    version: number,
    signal: AbortSignal,
  ) {
    const config = this.config();
    await this.store.ownedRevision(userId, id, version);
    const storage =
      this.storage ?? new SupabaseAttachmentStorage(config.storage);
    await storage.assertPrivate(signal);
    const row = await this.store.reserveRead(userId, id, version, config);
    if (row.bucket !== config.storage.bucket)
      throw new AppError("storage_unavailable", 503);
    const bytes = await storage.download(row.object_key, row.bytes, signal);
    if (
      bytes.length !== row.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== row.sha256
    )
      throw new AppError("image_integrity_failed", 503);
    inspectPng(bytes);
    await this.store.ownedRevision(userId, id, version);
    return { bytes, title: row.title };
  }
}
