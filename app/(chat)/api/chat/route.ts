import {
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import { finishRun, prepareRun } from "@/lib/actions/chat/branches";
import {
  deleteChat,
  getChatForUser,
  updateChat,
} from "@/lib/actions/chat/chat";
import {
  attachmentInstructions,
  attachmentTurns,
  resolveAttachmentRequest,
} from "@/lib/attachments/request";
import { lockAttachments } from "@/lib/attachments/store";
import { requireChatAccess } from "@/lib/auth/access";
import { resolveByokModel } from "@/lib/byok/config";
import { startByokStream } from "@/lib/byok/service";
import {
  assertTemporaryId,
  resolveContext,
  validateContextEntry,
} from "@/lib/context/service";
import { resolveFundingConfig } from "@/lib/credits/config";
import { boundedJson } from "@/lib/credits/http";
import {
  boundContext,
  startFundedStream,
  type TextTurn,
} from "@/lib/credits/service";
import { actorFor } from "@/lib/credits/store";
import type { DatabaseTransaction } from "@/lib/db/client";
import { AppError, logErrorId } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { assertSameOrigin } from "@/lib/http/origin";
import { postRequestBodySchema } from "@/lib/schema/chat/chat";
import type { TypeUIMessage } from "@/lib/types";
export const maxDuration = 30;
export async function POST(request: Request) {
  let run: { id: string; userId: string; branchId: string } | undefined;
  try {
    const access = await requireChatAccess(request.headers);
    assertSameOrigin(request);
    const parsed = postRequestBodySchema.safeParse(await boundedJson(request));
    if (!parsed.success) throw new AppError("invalid_request", 400);
    const body = parsed.data;
    if (
      body.webSearch ||
      body.visibility !== "private" ||
      body.message.parts.some((p) => p.type !== "text")
    )
      throw new AppError(
        body.funding === "platform"
          ? "funded_capability_denied"
          : "byok_capability_denied",
        403,
      );
    if (body.funding === "platform") {
      const config = resolveFundingConfig(process.env);
      if (body.model !== config.price.model)
        throw new AppError("model_not_funded", 403);
    } else resolveByokModel(process.env, body.model, body.funding);
    boundContext([
      {
        role: "user",
        content: body.message.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n"),
      },
    ]);
    if (
      body.temporary
        ? body.action !== "send" || body.anchorId || body.branchId !== body.id
        : body.transientMessages !== undefined
    )
      throw new AppError("invalid_request", 400);
    if (body.temporary && body.attachments?.ids.length)
      throw new AppError("temporary_attachments_unavailable", 400);
    const context = await resolveContext(access.userId, body.context);
    const selection = body.attachments?.ids.length
      ? {
          chatId: body.id,
          ids: body.attachments.ids,
          funding: body.funding,
          model: body.model,
        }
      : undefined;
    const files = selection
      ? await resolveAttachmentRequest(access.userId, selection, {
          expectedDigest: body.attachments?.digest,
        })
      : undefined;
    const instructions = files
      ? attachmentInstructions(context.instructions, files)
      : context.instructions;
    const validateEntry = async (tx: DatabaseTransaction) => {
      await validateContextEntry(tx, access.userId, body.context);
      if (selection && files) {
        await lockAttachments(tx);
        const fresh = await resolveAttachmentRequest(access.userId, selection, {
          expectedDigest: files.digest,
          executor: tx,
        });
        if (fresh.imageTokens !== files.imageTokens)
          throw new AppError("attachment_context_changed", 409);
      }
    };
    const serverMessage: TypeUIMessage = {
      ...body.message,
      parts: [
        ...(files?.provenance.length
          ? [
              {
                type: "data-attachments" as const,
                data: { sources: files.provenance },
              },
            ]
          : []),
        ...body.message.parts,
      ],
    } as TypeUIMessage;
    if (body.temporary) await assertTemporaryId(body.id);
    // The latest prompt plus selected excerpts must fit before creating a run.
    if (files)
      attachmentTurns(
        [
          {
            role: "user",
            content: body.message.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n"),
          },
        ],
        instructions,
        files,
      );
    const prepared = body.temporary
      ? { branchId: body.id, messages: [serverMessage] }
      : await prepareRun({ ...body, message: serverMessage }, access.userId);
    if (!body.temporary)
      run = {
        id: body.requestId,
        userId: access.userId,
        branchId: prepared.branchId,
      };
    let turns: TextTurn[] = prepared.messages.flatMap((m) =>
      m.role === "user" || m.role === "assistant"
        ? [
            {
              role: m.role,
              content: m.parts
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("\n"),
            },
          ]
        : [],
    );
    if (body.temporary) turns.unshift(...(body.transientMessages ?? []));
    // Context is resolved from owned rows, never accepted as caller-authored instructions.
    turns = files
      ? attachmentTurns(turns, instructions, files)
      : boundContext(turns, false, instructions);
    const result =
      body.funding !== "platform"
        ? await startByokStream({
            userId: access.userId,
            provider: body.funding,
            model: body.model,
            idempotencyKey: body.requestId,
            turns,
            instructions,
            validateEntry,
            ...(files?.imageTokens && selection
              ? {
                  attachmentImages: {
                    preview: files,
                    load: () =>
                      resolveAttachmentRequest(access.userId, selection, {
                        expectedDigest: files.digest,
                        includeImageBytes: true,
                      }),
                  },
                }
              : {}),
            env: process.env,
            signal: request.signal,
          })
        : await startFundedStream({
            env: process.env,
            retainProviderReference: !body.temporary,
            actor: actorFor(
              "user",
              access.userId,
              process.env.CREDIT_ACTOR_SECRET ?? "",
            ),
            model: body.model,
            idempotencyKey: body.requestId,
            turns,
            instructions,
            validateEntry,
            signal: request.signal,
          });
    void result.completion.catch(() =>
      logErrorId("generation_completion_failed"),
    );
    let failed = false;
    let stopped = false;
    let completed = false;
    const stream = createUIMessageStream<UIMessage>({
      originalMessages: prepared.messages,
      generateId: () => crypto.randomUUID(),
      execute: async ({ writer }) => {
        const reader = result.stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value.type === "error") failed = true;
            if (
              value.type === "finish" &&
              (value.finishReason === "stop" || value.finishReason === "length")
            )
              completed = true;
            if (value.type === "abort") stopped = true;
            if (
              value.type === "finish" &&
              (value.finishReason === "error" ||
                value.finishReason === "content-filter")
            )
              failed = true;
            writer.write(value);
          }
          writer.setOutcome(
            stopped
              ? { status: "aborted" }
              : failed || !completed
                ? { status: "failed" }
                : { status: "completed" },
          );
        } finally {
          reader.releaseLock();
        }
      },
      onEnd: async ({ responseMessage, outcome, isAborted }) => {
        if (body.temporary) return;
        await finishRun(
          body.requestId,
          access.userId,
          isAborted || request.signal.aborted
            ? "stopped"
            : failed || outcome.status !== "completed"
              ? "error"
              : "complete",
          {
            id: responseMessage.id,
            role: responseMessage.role,
            parts: responseMessage.parts,
          },
        );
      },
      onError: () => "chat_failed",
    });
    return createUIMessageStreamResponse({
      stream,
      headers: {
        "cache-control": "no-store",
        ...(body.temporary ? {} : { "x-chat-branch": prepared.branchId }),
      },
      consumeSseStream: ({ stream }) =>
        consumeStream({
          stream,
          onError: () => logErrorId("chat_persistence_failed"),
        }),
    });
  } catch (error) {
    if (run)
      await finishRun(
        run.id,
        run.userId,
        request.signal.aborted ? "stopped" : "error",
      ).catch(() => logErrorId("chat_persistence_failed"));
    const response = errorResponse(
      request.signal.aborted ? new AppError("request_cancelled", 499) : error,
      "chat_failed",
    );
    response.headers.set("cache-control", "no-store");
    if (run) response.headers.set("x-chat-branch", run.branchId);
    return response;
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: { id: "invalid_chat" } },
      { status: 400 },
    );
  }

  try {
    const access = await requireChatAccess(request.headers);
    const chat = await getChatForUser(id, access.userId);
    if (!chat) {
      return NextResponse.json({ error: { id: "forbidden" } }, { status: 403 });
    }
    const deletedChat = await deleteChat(id, access.userId);
    return Response.json(deletedChat, { status: 200 });
  } catch (error) {
    return errorResponse(error, "chat_failed");
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    const json: unknown = await request.json();
    if (!json || typeof json !== "object") {
      throw new AppError("invalid_request", 400);
    }
    const id =
      "id" in json && typeof json.id === "string" ? json.id.trim() : "";
    const title =
      "title" in json && typeof json.title === "string"
        ? json.title.trim()
        : "";
    if (!id || !title || title.length > 200) {
      throw new AppError("invalid_title", 400);
    }
    const chat = await getChatForUser(id, access.userId);
    if (!chat) {
      return NextResponse.json({ error: { id: "forbidden" } }, { status: 403 });
    }
    const updated = await updateChat({
      id,
      title,
      userId: access.userId,
    });
    return NextResponse.json(updated);
  } catch (error) {
    return errorResponse(error, "chat_failed");
  }
}
