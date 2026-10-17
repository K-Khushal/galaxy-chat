import { createUIMessageStreamResponse } from "ai";
import { z } from "zod";
import type { EnvSource } from "@/lib/auth/env";
import {
  guestConfig,
  guestCookie,
  guestId,
  guestNetwork,
  signedGuest,
  verifyGuestBot,
} from "@/lib/credits/guest";
import { boundedJson } from "@/lib/credits/http";
import { type FundedProvider, startFundedStream } from "@/lib/credits/service";
import { creditStatus } from "@/lib/credits/status";
import { actorFor, CreditStore } from "@/lib/credits/store";
import { AppError, logErrorId } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";

const requestSchema = z
  .object({
    requestId: z.uuid(),
    text: z.string().min(1).max(2_000),
    botToken: z.string().min(1).max(2_048),
  })
  .strict();
const limitations = [
  "One basic text generation. Sign in for saved chats.",
  "No files, tools, advanced models, storage or memory.",
  "Cookie resets and other devices can bypass anonymous identity; one person cannot be guaranteed.",
];
// Dependency seam allows local database/provider/bot tests without paid calls.
export function guestHandlers(options: {
  env: EnvSource;
  store?: CreditStore;
  provider?: FundedProvider;
  verifyBot?: typeof verifyGuestBot;
}) {
  const store = () => options.store ?? new CreditStore();
  return {
    GET: async (request: Request) => {
      try {
        const config = guestConfig(options.env);
        const current = guestId(request.headers, config.secret);
        const cookie = current ? undefined : signedGuest(config.secret);
        const id = current ?? cookie?.split(".")[0];
        if (!id) throw new AppError("guest_unconfigured", 503);
        const actor = actorFor(
          "guest",
          id,
          options.env.CREDIT_ACTOR_SECRET ?? "",
        );
        const db = store();
        const status = await creditStatus(options.env, actor, db);
        const used = await db.guestUsed(actor);
        const siteKey = config.siteKey;
        const state = used
          ? "used"
          : status.state === "available"
            ? "available"
            : status.state === "busy"
              ? "busy"
              : "disabled";
        const headers = new Headers({ "cache-control": "no-store" });
        if (cookie) headers.set("set-cookie", guestCookie(cookie));
        return Response.json(
          {
            state,
            remainingGenerations: state === "available" ? 1 : 0,
            ...(state === "available" ? { siteKey } : {}),
            limitations,
            ...(state === "disabled"
              ? {
                  reason: status.reason ?? status.state,
                }
              : {}),
          },
          { headers },
        );
      } catch (error) {
        return Response.json(
          {
            state: "disabled",
            remainingGenerations: 0,
            limitations,
            reason: error instanceof AppError ? error.id : "guest_unavailable",
          },
          { headers: { "cache-control": "no-store" } },
        );
      }
    },
    POST: async (request: Request) => {
      try {
        const config = guestConfig(options.env);
        if (request.headers.get("origin") !== config.origin)
          throw new AppError("forbidden", 403);
        const id = guestId(request.headers, config.secret);
        if (!id) throw new AppError("guest_verification_required", 403);
        const json = requestSchema.safeParse(await boundedJson(request, 8_000));
        if (!json.success) throw new AppError("invalid_request", 400);
        const { requestId, text, botToken } = json.data;
        const db = store();
        const network = guestNetwork(request.headers, config.secret);
        await db.guestAttempt(network.key);
        const actor = actorFor(
          "guest",
          id,
          options.env.CREDIT_ACTOR_SECRET ?? "",
        );
        if (await db.guestUsed(actor))
          throw new AppError("guest_limit_reached", 429);
        try {
          await (options.verifyBot ?? verifyGuestBot)(
            config,
            botToken,
            network.ip,
            requestId,
          );
        } catch {
          throw new AppError("guest_verification_required", 403);
        }
        const result = await startFundedStream({
          env: options.env,
          actor,
          idempotencyKey: requestId,
          turns: [{ role: "user", content: text }],
          store: db,
          provider: options.provider,
          signal: request.signal,
        });
        void result.completion.catch(() =>
          logErrorId("credit_settlement_failed"),
        );
        return createUIMessageStreamResponse({
          stream: result.stream,
          headers: { "cache-control": "no-store" },
        });
      } catch (error) {
        const response = errorResponse(error, "guest_failed");
        response.headers.set("cache-control", "no-store");
        return response;
      }
    },
  };
}
