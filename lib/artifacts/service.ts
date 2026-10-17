import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { requireDb } from "@/lib/db/client";
import {
  artifact,
  artifactRevision,
  chat,
  chatMessage,
  user,
} from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { parseChartSource } from "./chart-spec";
import {
  type ArtifactDocument,
  type ArtifactSummary,
  artifactContent,
  artifactKind,
  artifactLimits,
  artifactMutation,
  artifactSource,
} from "./contract";

const owned = (id: string, userId: string) =>
  and(eq(artifact.id, id), eq(artifact.userId, userId));
function summary(
  row: typeof artifact.$inferSelect,
  title: string,
): ArtifactSummary {
  return {
    id: row.id,
    chatId: row.chatId,
    messageId: row.messageId,
    kind: artifactKind.parse(row.kind),
    version: row.head,
    title,
    updatedAt: row.updatedAt.toISOString(),
  };
}
export async function listArtifacts(userId: string, chatId: string) {
  const db = requireDb();
  const parent = await db
    .select({ id: chat.id })
    .from(chat)
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
    .limit(1);
  if (!parent[0]) throw new AppError("not_found", 404);
  const rows = await db
    .select({ artifact, title: artifactRevision.title })
    .from(artifact)
    .innerJoin(
      artifactRevision,
      and(
        eq(artifactRevision.artifactId, artifact.id),
        eq(artifactRevision.version, artifact.head),
        eq(artifactRevision.userId, userId),
      ),
    )
    .where(and(eq(artifact.chatId, chatId), eq(artifact.userId, userId)))
    .orderBy(desc(artifact.updatedAt), asc(artifact.id))
    .limit(artifactLimits.artifacts);
  return rows.map((row) => summary(row.artifact, row.title));
}
export async function readArtifact(
  userId: string,
  id: string,
): Promise<ArtifactDocument> {
  const db = requireDb();
  const rows = await db
    .select({ artifact, revision: artifactRevision })
    .from(artifact)
    .innerJoin(
      artifactRevision,
      and(
        eq(artifactRevision.artifactId, artifact.id),
        eq(artifactRevision.userId, userId),
      ),
    )
    .where(owned(id, userId))
    .orderBy(desc(artifactRevision.version))
    .limit(artifactLimits.revisions);
  const head = rows.find((row) => row.revision.version === row.artifact.head);
  if (!head) throw new AppError("not_found", 404);
  return {
    ...summary(head.artifact, head.revision.title),
    content: head.revision.content,
    revisions: rows.map(({ revision }) => ({
      version: revision.version,
      title: revision.title,
      restoredFrom: revision.restoredFrom,
      createdAt: revision.createdAt.toISOString(),
    })),
  };
}
export async function mutateArtifact(
  userId: string,
  raw: unknown,
): Promise<{ id: string; deleted?: true }> {
  const parsed = artifactMutation.safeParse(raw);
  if (!parsed.success) throw new AppError("invalid_artifact", 400);
  const input = parsed.data;
  const db = requireDb();
  return db.transaction(async (tx) => {
    // A real owner row lock serializes all artifact creates/revisions/deletes and
    // quotas, and races safely with account deletion. No global or hash lock.
    const owner = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("update");
    if (!owner[0]) throw new AppError("not_found", 404);
    let content: string;
    let title: string;
    let version: number;
    let id: string;
    let restoredFrom: number | null = null;
    if (input.action === "create") {
      const origin = await tx
        .select({ parts: chatMessage.parts })
        .from(chatMessage)
        .innerJoin(
          chat,
          and(eq(chat.id, chatMessage.chatId), eq(chat.userId, userId)),
        )
        .where(
          and(
            eq(chatMessage.id, input.messageId),
            eq(chatMessage.chatId, input.chatId),
            eq(chatMessage.userId, userId),
            eq(chatMessage.role, "assistant"),
          ),
        )
        .limit(1);
      if (!origin[0]) throw new AppError("not_found", 404);
      const source = artifactSource(origin[0].parts, input.kind);
      if (!source.trim() || !artifactContent.safeParse(source).success)
        throw new AppError("invalid_artifact", 400);
      if (input.kind === "chart" && !parseChartSource(source).success)
        throw new AppError("invalid_artifact", 400);
      const count = await tx
        .select({ count: sql<number>`count(*)::integer` })
        .from(artifact)
        .where(eq(artifact.userId, userId));
      if (count[0].count >= artifactLimits.artifacts)
        throw new AppError("artifact_limit", 409);
      id = crypto.randomUUID();
      version = 1;
      title = input.title;
      content = source;
      await tx.insert(artifact).values({
        id,
        userId,
        chatId: input.chatId,
        messageId: input.messageId,
        kind: input.kind,
        head: version,
      });
    } else {
      const row = (
        await tx
          .select()
          .from(artifact)
          .where(owned(input.id, userId))
          .for("update")
      )[0];
      if (!row) throw new AppError("not_found", 404);
      if (input.action === "delete") {
        await tx.delete(artifact).where(owned(row.id, userId));
        return { id: row.id, deleted: true };
      }
      if (row.head !== input.expectedVersion)
        throw new AppError("artifact_conflict", 409);
      if (row.head >= artifactLimits.revisions)
        throw new AppError("artifact_revision_limit", 409);
      id = row.id;
      version = row.head + 1;
      if (input.action === "restore") {
        const revision = (
          await tx
            .select()
            .from(artifactRevision)
            .where(
              and(
                eq(artifactRevision.artifactId, id),
                eq(artifactRevision.userId, userId),
                eq(artifactRevision.version, input.version),
              ),
            )
            .limit(1)
        )[0];
        if (!revision) throw new AppError("not_found", 404);
        content = revision.content;
        title = revision.title;
        restoredFrom = revision.version;
      } else {
        content = input.content;
        title = input.title;
      }
      if (row.kind === "chart" && !parseChartSource(content).success)
        throw new AppError("invalid_artifact", 400);
      await tx
        .update(artifact)
        .set({ head: version, updatedAt: new Date() })
        .where(owned(id, userId));
    }
    const usage = await tx
      .select({
        bytes: sql<number>`coalesce(sum(octet_length(${artifactRevision.content})),0)::integer`,
      })
      .from(artifactRevision)
      .where(eq(artifactRevision.userId, userId));
    if (
      usage[0].bytes + new TextEncoder().encode(content).byteLength >
      artifactLimits.ownerBytes
    )
      throw new AppError("artifact_storage_limit", 409);
    await tx.insert(artifactRevision).values({
      artifactId: id,
      userId,
      version,
      title,
      content,
      restoredFrom,
    });
    return { id };
  });
}
