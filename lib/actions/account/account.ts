import { asc, desc, eq, sql } from "drizzle-orm";
import type { AttachmentView } from "@/lib/attachments/contract";
import { cleanupAfterDeletion } from "@/lib/attachments/service";
import { attachmentView, lockAttachments } from "@/lib/attachments/store";
import { resourceActor } from "@/lib/byok/config";
import type { CredentialView } from "@/lib/byok/contract";
import { ByokStore, lockByokResources } from "@/lib/byok/store";
import { lockContext } from "@/lib/context/service";
import { requireDb } from "@/lib/db/client";
import {
  account,
  artifact,
  artifactRevision,
  chatBranch,
  chatMessage,
  chatRun,
  chat as chatTable,
  memory,
  project,
  usageRecord,
  user,
} from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { ImageStore } from "@/lib/images/store";
import { JobStore } from "@/lib/jobs/store";
import { createMcpCatalogStore } from "@/lib/mcp/catalog-store";
import { createMcpExecutionStore } from "@/lib/mcp/execution-store";
import { createMcpOAuthStore } from "@/lib/mcp/oauth-store";
import { createMcpOperationStore } from "@/lib/mcp/operation-store";
import { McpRegistryStore } from "@/lib/mcp/registry-store";
import { SandboxStore } from "@/lib/sandbox/store";
import { SearchStore } from "@/lib/search/store";
import { ToolStore } from "@/lib/tools/store";

export type AccountProfile = {
  id: string;
  name: string;
  email: string;
  githubLogin: string | null;
  createdAt: Date;
};

export type AccountExport = {
  profile: AccountProfile;
  jobs: Awaited<ReturnType<JobStore["export"]>>;
  sandboxOperations: Awaited<ReturnType<SandboxStore["exportOperations"]>>;
  imageData: Awaited<ReturnType<ImageStore["export"]>>;
  toolData: Awaited<ReturnType<ToolStore["export"]>>;
  attachments: Array<AttachmentView & { extractedText: string }>;
  artifacts: Array<typeof artifact.$inferSelect>;
  artifactRevisions: Array<typeof artifactRevision.$inferSelect>;
  memories: Array<typeof memory.$inferSelect>;
  projects: Array<typeof project.$inferSelect>;
  providerCredentials: CredentialView[];
  searchCredentials: Awaited<ReturnType<SearchStore["credentials"]>>;
  mcpOAuthGrants: Awaited<
    ReturnType<ReturnType<typeof createMcpOAuthStore>["metadata"]>
  >;
  mcpConnections: Awaited<ReturnType<McpRegistryStore["export"]>>;
  mcpCatalogs: Awaited<
    ReturnType<ReturnType<typeof createMcpCatalogStore>["export"]>
  >;
  mcpRuntime: Awaited<
    ReturnType<ReturnType<typeof createMcpExecutionStore>["exportMetadata"]>
  >;
  mcpOperations: Awaited<
    ReturnType<ReturnType<typeof createMcpOperationStore>["export"]>
  >;
  byokOperations: Array<{
    id: string;
    provider: string;
    kind: string;
    state: string;
    createdAt: Date;
  }>;
  chats: Array<{
    id: string;
    title: string;
    visibility: string;
    projectId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  messages: Array<{
    id: string;
    chatId: string;
    role: string;
    parts: unknown;
    attachments: unknown;
    createdAt: Date;
    updatedAt: Date;
  }>;
  branches: Array<typeof chatBranch.$inferSelect>;
  runs: Array<typeof chatRun.$inferSelect>;
  usageRecords: Array<{
    id: string;
    chatId: string | null;
    createdAt: Date;
  }>;
};

async function ownedProfile(userId: string): Promise<AccountProfile> {
  const db = requireDb();
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      githubLogin: user.githubLogin,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const profile = rows[0];
  if (!profile) {
    throw new AppError("not_found", 404);
  }
  return profile;
}

export async function readOwnedProfile(userId: string) {
  return ownedProfile(userId);
}

export async function exportOwnedAccount(
  userId: string,
): Promise<AccountExport> {
  const db = requireDb();
  const profile = await ownedProfile(userId);
  const jobs = await new JobStore(db).export(userId);
  const imageData = await new ImageStore(db).export(userId);
  const toolData = await new ToolStore(db).export(userId);
  const chats = await db
    .select({
      id: chatTable.id,
      title: chatTable.title,
      visibility: chatTable.visibility,
      projectId: chatTable.projectId,
      createdAt: chatTable.createdAt,
      updatedAt: chatTable.updatedAt,
    })
    .from(chatTable)
    .where(eq(chatTable.userId, userId))
    .orderBy(desc(chatTable.createdAt), desc(chatTable.id));
  const messages = await db
    .select({
      id: chatMessage.id,
      chatId: chatMessage.chatId,
      role: chatMessage.role,
      parts: chatMessage.parts,
      attachments: chatMessage.attachments,
      createdAt: chatMessage.createdAt,
      updatedAt: chatMessage.updatedAt,
    })
    .from(chatMessage)
    .where(eq(chatMessage.userId, userId))
    .orderBy(asc(chatMessage.createdAt), asc(chatMessage.id));
  const usageRecords = await db
    .select({
      id: usageRecord.id,
      chatId: usageRecord.chatId,
      createdAt: usageRecord.createdAt,
    })
    .from(usageRecord)
    .where(eq(usageRecord.userId, userId))
    .orderBy(asc(usageRecord.createdAt), asc(usageRecord.id));
  const branches = await db
    .select()
    .from(chatBranch)
    .where(eq(chatBranch.userId, userId));
  const runs = await db
    .select()
    .from(chatRun)
    .where(eq(chatRun.userId, userId));
  const artifacts = await db
    .select()
    .from(artifact)
    .where(eq(artifact.userId, userId));
  const artifactRevisions = await db
    .select()
    .from(artifactRevision)
    .where(eq(artifactRevision.userId, userId));
  const memories = await db
    .select()
    .from(memory)
    .where(eq(memory.userId, userId));
  const projects = await db
    .select()
    .from(project)
    .where(eq(project.userId, userId));
  const providerCredentials = await new ByokStore(db).credentials(userId);
  const searchCredentials = await new SearchStore(db).credentials(userId);
  const mcpConnections = await new McpRegistryStore(db).export(userId);
  const mcpCatalogs = await createMcpCatalogStore({ db }).export(userId);
  const mcpOAuthGrants = await createMcpOAuthStore({ db }).metadata(userId);
  const mcpOperations = await createMcpOperationStore({ db }).export(userId);
  const mcpRuntime = await createMcpExecutionStore({ db }).exportMetadata(
    userId,
  );
  let actor: string | undefined;
  try {
    actor = resourceActor(userId, process.env);
  } catch {
    /* Unconfigured resource metadata is unavailable. */
  }
  const operations = actor
    ? await db.execute<{
        id: string;
        provider: string;
        kind: string;
        state: string;
        created_at: Date;
      }>(
        sql`SELECT id,provider,kind,state,created_at FROM byok_operation WHERE actor_key=${actor}`,
      )
    : [];
  const byokOperations = operations.map((row) => ({
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    state: row.state,
    createdAt: row.created_at,
  }));
  const attachmentRows = await db.execute<
    import("@/lib/attachments/store").AttachmentRow
  >(sql`SELECT * FROM attachment WHERE user_id=${userId} ORDER BY created_at`);
  const attachments = attachmentRows.map((row) => ({
    ...attachmentView(row),
    extractedText: row.extracted_text,
  }));
  return {
    profile,
    sandboxOperations: await new SandboxStore(db).exportOperations(userId),
    jobs,
    toolData,
    imageData,
    attachments,
    artifacts,
    artifactRevisions,
    memories,
    projects,
    chats,
    messages,
    usageRecords,
    branches,
    runs,
    providerCredentials,
    searchCredentials,
    mcpConnections,
    mcpCatalogs,
    mcpOAuthGrants,
    mcpOperations,
    mcpRuntime,
    byokOperations,
  };
}

export async function deleteOwnedAccount(userId: string) {
  const db = requireDb();
  let hasAttachments = false;
  await db.transaction(async (tx) => {
    // Serialize deletion with credential reads/provider entry. Anonymous resource
    // leases survive the cascade and still count until remote work is terminal.
    await lockByokResources(tx);
    await lockContext(tx, userId);
    await lockAttachments(tx);
    hasAttachments = Boolean(
      (
        await tx.execute(
          sql`SELECT id FROM attachment WHERE user_id=${userId} UNION ALL SELECT id FROM image_object WHERE user_id=${userId} LIMIT 1`,
        )
      )[0],
    );
    const owned = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!owned[0]) {
      throw new AppError("not_found", 404);
    }
    await tx.delete(account).where(eq(account.userId, userId));
    await tx.delete(user).where(eq(user.id, userId));
  });
  return hasAttachments
    ? { deleted: true, attachmentCleanup: await cleanupAfterDeletion() }
    : { deleted: true };
}
