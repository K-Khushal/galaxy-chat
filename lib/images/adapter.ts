import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateImage, type ImageModel } from "ai";
import { readBounded } from "@/lib/attachments/content";
import { AppError } from "@/lib/errors";
import { type ImageSnapshot, imageLimits, imageUsd } from "./contract";
import { canonicalPng } from "./png";
export interface ImageAdapter {
  generate(input: {
    key: string;
    prompt: string;
    model: ImageSnapshot;
    signal: AbortSignal;
  }): Promise<ReturnType<typeof canonicalPng>>;
}
/** Only the installed adapter's fixed image endpoint may receive a user's key. */
export function boundedImageFetch(network: typeof fetch = fetch): typeof fetch {
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (
        url.href !== "https://openrouter.ai/api/v1/images" ||
        init?.method !== "POST"
      )
        throw new AppError("image_provider_route_denied", 503);
      const response = await network(input, {
        ...init,
        redirect: "manual",
        cache: "no-store",
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new AppError("image_provider_redirect_denied", 503);
      }
      const limit = response.ok
        ? Math.ceil(imageLimits.bytes / 3) * 4 + 65_536
        : 16_384;
      if (Number(response.headers.get("content-length") ?? 0) > limit) {
        await response.body?.cancel();
        throw new AppError("image_provider_size_limit", 413);
      }
      const bytes = await readBounded(
        response.body,
        limit,
        init?.signal ?? undefined,
      );
      if (!response.ok) throw new AppError("image_provider_failed", 503);
      try {
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (
          !value ||
          typeof value !== "object" ||
          !("data" in value) ||
          !Array.isArray(value.data) ||
          value.data.length !== 1
        )
          throw Error();
        const item = value.data[0];
        if (
          !item ||
          typeof item !== "object" ||
          "url" in item ||
          typeof item.b64_json !== "string" ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(item.b64_json) ||
          item.b64_json.length > Math.ceil(imageLimits.bytes / 3) * 4
        )
          throw Error();
        const decoded = Buffer.from(item.b64_json, "base64");
        if (
          !decoded.length ||
          decoded.length > imageLimits.bytes ||
          decoded.toString("base64") !== item.b64_json
        )
          throw Error();
        return Response.json({ data: [{ b64_json: item.b64_json }] });
      } catch {
        throw new AppError("image_invalid_response", 415);
      }
    },
    { preconnect: network.preconnect },
  );
}
export function requireImageCapability(
  model: Exclude<ImageModel, string>,
  reference: boolean,
  mask: boolean,
) {
  if (
    (reference &&
      (!("supportsFileInputs" in model) ||
        model.supportsFileInputs !== true)) ||
    (mask &&
      (!("supportsMaskInputs" in model) || model.supportsMaskInputs !== true))
  )
    throw new AppError("image_capability_unavailable", 400);
}
export class OpenRouterImageAdapter implements ImageAdapter {
  constructor(
    private readonly network: typeof fetch = fetch,
    private readonly sdk: typeof generateImage = generateImage,
  ) {}
  async generate({
    key,
    prompt,
    model,
    signal,
  }: {
    key: string;
    prompt: string;
    model: ImageSnapshot;
    signal: AbortSignal;
  }) {
    const provider = createOpenRouter({
      apiKey: key,
      fetch: boundedImageFetch(this.network),
    });
    const instantiated = provider.imageModel(model.model, {
      provider: {
        only: [model.provider],
        order: [model.provider],
        allow_fallbacks: false,
        require_parameters: true,
        max_price: {
          image: imageUsd(model.providerMaxMicrodollarsPerImage),
        },
      },
    });
    const result = await this.sdk({
      model: instantiated,
      prompt,
      n: 1,
      maxImagesPerCall: 1,
      size: "1024x1024",
      maxRetries: 0,
      abortSignal: AbortSignal.any([
        signal,
        AbortSignal.timeout(imageLimits.milliseconds),
      ]),
    });
    if (result.images.length !== 1 || result.warnings.length)
      throw new AppError("image_invalid_response", 415);
    return canonicalPng(
      result.images[0].uint8Array,
      result.images[0].mediaType,
    );
  }
}
