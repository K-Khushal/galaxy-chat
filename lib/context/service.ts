import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { INSTRUCTIONS } from "@/lib/credits/config";
import { requireDb } from "@/lib/db/client";
import { chat, memory, project } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import {
  CONTEXT_LIMITS,
  type ContextSelection,
  type ContextView,
  contextMutationSchema,
} from "./contract";
export async function contextLibrary(userId: string, includeChats = true) {
  const db = requireDb();
  const memories = await db
    .select()
    .from(memory)
    .where(eq(memory.userId, userId))
    .orderBy(asc(memory.id));
  const projects = await db
    .select()
    .from(project)
    .where(eq(project.userId, userId))
    .orderBy(asc(project.name), asc(project.id));
  const chats = includeChats
    ? await db
        .select({ id: chat.id, title: chat.title, projectId: chat.projectId })
        .from(chat)
        .where(eq(chat.userId, userId))
        .orderBy(asc(chat.title))
    : [];
  return { memories, projects, chats };
}
export async function resolveContext(
  userId: string,
  selection?: ContextSelection,
  verify = true,
): Promise<ContextView> {
  const library = await contextLibrary(userId, false);
  const projectId = selection?.projectId ?? null;
  const selectedProject = projectId
    ? library.projects.find((p) => p.id === projectId)
    : null;
  if (projectId && !selectedProject) throw new AppError("context_changed", 409);
  const ids = selection?.memoryIds ?? [];
  if (new Set(ids).size !== ids.length || ids.length > CONTEXT_LIMITS.memories)
    throw new AppError("invalid_context", 400);
  const memories = ids.map((id) => {
    const item = library.memories.find(
      (m) => m.id === id && (!m.projectId || m.projectId === projectId),
    );
    if (!item) throw new AppError("context_changed", 409);
    return { id: item.id, content: item.content };
  });
  const chosenProject = selectedProject
    ? {
        id: selectedProject.id,
        name: selectedProject.name,
        instructions: selectedProject.instructions,
      }
    : null;
  const instructions =
    INSTRUCTIONS +
    (chosenProject
      ? `\nUser-selected project instructions:\n${chosenProject.instructions}`
      : "") +
    (memories.length
      ? "\nUser-selected memories (context, not verified facts):\n" +
        memories.map((m, i) => `${i + 1}. ${m.content}`).join("\n")
      : "");
  const instructionBytes = new TextEncoder().encode(
    JSON.stringify(instructions),
  ).length;
  if (instructionBytes > CONTEXT_LIMITS.instructionBytes)
    throw new AppError("context_too_large", 400);
  const digest = createHash("sha256")
    .update(JSON.stringify({ project: chosenProject, memories }))
    .digest("hex");
  if (
    verify &&
    (ids.length || projectId || selection?.digest) &&
    selection?.digest !== digest
  )
    throw new AppError("context_changed", 409);
  return {
    project: chosenProject,
    memories,
    instructions,
    digest,
    instructionBytes,
    limits: CONTEXT_LIMITS,
  };
}
export async function mutateContext(userId: string, json: unknown) {
  const parsed = contextMutationSchema.safeParse(json);
  if (!parsed.success) throw new AppError("invalid_context", 400);
  const input = parsed.data;
  if (input.action === "preview")
    return resolveContext(userId, input.selection, false);
  const db = requireDb();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`context:${userId}`}))`,
    );
    if (input.action === "memory.save") {
      if (new TextEncoder().encode(input.content).length > 1800)
        throw new AppError("context_too_large", 400);
      if (
        input.projectId &&
        !(
          await tx
            .select()
            .from(project)
            .where(
              and(eq(project.id, input.projectId), eq(project.userId, userId)),
            )
        )[0]
      )
        throw new AppError("not_found", 404);
      if (input.id) {
        const rows = await tx
          .update(memory)
          .set({
            content: input.content,
            projectId: input.projectId,
            updatedAt: new Date(),
          })
          .where(and(eq(memory.id, input.id), eq(memory.userId, userId)))
          .returning();
        if (!rows[0]) throw new AppError("not_found", 404);
      } else {
        if (
          (
            await tx
              .select({ id: memory.id })
              .from(memory)
              .where(eq(memory.userId, userId))
          ).length >= 100
        )
          throw new AppError("memory_limit_reached", 400);
        await tx.insert(memory).values({
          id: crypto.randomUUID(),
          userId,
          content: input.content,
          projectId: input.projectId,
        });
      }
    } else if (input.action === "project.save") {
      if (new TextEncoder().encode(input.instructions).length > 3000)
        throw new AppError("context_too_large", 400);
      if (input.id) {
        const rows = await tx
          .update(project)
          .set({
            name: input.name,
            instructions: input.instructions,
            updatedAt: new Date(),
          })
          .where(and(eq(project.id, input.id), eq(project.userId, userId)))
          .returning();
        if (!rows[0]) throw new AppError("not_found", 404);
      } else {
        if (
          (
            await tx
              .select({ id: project.id })
              .from(project)
              .where(eq(project.userId, userId))
          ).length >= 30
        )
          throw new AppError("project_limit_reached", 400);
        await tx.insert(project).values({
          id: crypto.randomUUID(),
          userId,
          name: input.name,
          instructions: input.instructions,
        });
      }
    } else {
      const table = input.action === "memory.delete" ? memory : project;
      const rows = await tx
        .delete(table)
        .where(and(eq(table.id, input.id), eq(table.userId, userId)))
        .returning({ id: table.id });
      if (!rows[0]) throw new AppError("not_found", 404);
    }
    return { saved: true };
  });
}
/** Temporary identifiers may never reopen any persisted conversation. */
export async function assertTemporaryId(id: string) {
  if (
    (
      await requireDb()
        .select({ id: chat.id })
        .from(chat)
        .where(eq(chat.id, id))
    )[0]
  )
    throw new AppError("temporary_conflict", 409);
}
