import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { artifactLimits } from "@/lib/artifacts/contract";
import type { AttachmentConfig } from "@/lib/attachments/config";
import {
  lockAttachments,
  privateOwnerKey,
  reservePrivateCapacity,
  reservePrivateTransfer,
} from "@/lib/attachments/store";
import type { EnvSource } from "@/lib/auth/env";
import { ByokStore, lockByokResources } from "@/lib/byok/store";
import { type DatabaseTransaction, requireDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { imageSnapshot, validateImageReview } from "./config";
import {
  type ImageProvenance,
  type ImageRequest,
  type ImageSnapshot,
  type ImageStatus,
  imageLimits,
} from "./contract";

type Db = ReturnType<typeof requireDb>;
type Generation = {
  id: string;
  user_id: string;
  chat_id: string;
  message_id: string;
  artifact_id: string;
  expected_head: number;
  request: ImageRequest;
  model_snapshot: ImageSnapshot;
  state: ImageStatus["state"];
  cancelled: boolean;
};
export type ImageObject = {
  id: string;
  user_id: string;
  generation_id: string;
  artifact_id: string | null;
  version: number | null;
  bucket: string;
  object_key: string;
  bytes: number;
  state: "processing" | "ready";
  upload_state: "reserved" | "entered" | "terminal";
  sha256: string | null;
};
export class ImageStore {
  constructor(readonly db: Db = requireDb()) {}
  private async lock(tx: DatabaseTransaction, userId: string) {
    await lockByokResources(tx);
    await lockAttachments(tx);
    const rows = await tx.execute(
      sql`SELECT id FROM "user" WHERE id=${userId} FOR UPDATE`,
    );
    if (!rows[0]) throw new AppError("not_found", 404);
  }
  private async origin(
    tx: DatabaseTransaction,
    userId: string,
    input: ImageRequest,
  ) {
    const origin = await tx.execute(
      sql`SELECT m.id FROM chat_message m JOIN chat c ON c.id=m.chat_id AND c.user_id=m.user_id WHERE m.id=${input.messageId} AND m.chat_id=${input.chatId} AND m.user_id=${userId} AND m.role='assistant' FOR KEY SHARE OF m,c`,
    );
    if (!origin[0]) throw new AppError("not_found", 404);
    if (input.target) {
      const rows = await tx.execute<{ head: number }>(
        sql`SELECT head FROM artifact WHERE id=${input.target.id} AND user_id=${userId} AND chat_id=${input.chatId} AND message_id=${input.messageId} AND kind='image' FOR UPDATE`,
      );
      if (!rows[0]) throw new AppError("not_found", 404);
      if (rows[0].head !== input.target.expectedVersion)
        throw new AppError("artifact_conflict", 409);
    }
  }
  async reserve(
    userId: string,
    input: ImageRequest,
    model: ImageSnapshot,
    config: AttachmentConfig,
    env: EnvSource,
  ) {
    return this.db.transaction(
      async (tx) => {
        await this.lock(tx, userId);
        validateImageReview(input, imageSnapshot(env), model);
        await this.origin(tx, userId, input);
        const [counts] = await tx.execute<{ total: number; history: number }>(
          sql`SELECT (SELECT count(*) FROM artifact WHERE user_id=${userId})::integer+(SELECT count(*) FROM image_generation WHERE user_id=${userId} AND expected_head=0 AND state IN ('reserved','entered','held') AND NOT cancelled)::integer AS total,(SELECT count(*) FROM image_generation WHERE user_id=${userId})::integer AS history`,
        );
        if (
          (!input.target && counts.total >= artifactLimits.artifacts) ||
          counts.history >= 200
        )
          throw new AppError("artifact_limit", 409);
        const artifactId = input.target?.id ?? crypto.randomUUID();
        const prior = await tx.execute(
          sql`SELECT id FROM image_generation WHERE id=${input.requestId} OR (artifact_id=${artifactId} AND state IN ('reserved','entered','held') AND NOT cancelled)`,
        );
        if (prior.length) throw new AppError("request_already_processed", 409);
        await new ByokStore(this.db).reserveIn(tx, {
          id: input.requestId,
          userId,
          provider: "openrouter",
          kind: "image",
          digest: createHash("sha256")
            .update(JSON.stringify(input))
            .digest("hex"),
          env,
          revision: input.credentialRevision,
        });
        await reservePrivateCapacity(tx, userId, imageLimits.bytes, config);
        await reservePrivateTransfer(tx, imageLimits.bytes, config);
        const id = crypto.randomUUID(),
          key = `${privateOwnerKey(userId)}/${id}`;
        await tx.execute(
          sql`INSERT INTO image_generation(id,user_id,chat_id,message_id,artifact_id,expected_head,request,model_snapshot,state) VALUES(${input.requestId},${userId},${input.chatId},${input.messageId},${artifactId},${input.target?.expectedVersion ?? 0},${JSON.stringify(input)}::jsonb,${JSON.stringify(model)}::jsonb,'reserved')`,
        );
        const [object] = await tx.execute<ImageObject>(
          sql`INSERT INTO image_object(id,user_id,generation_id,chat_id,bucket,object_key,bytes,state,lease_until) VALUES(${id},${userId},${input.requestId},${input.chatId},${config.storage.bucket},${key},${imageLimits.bytes},'processing',now()+interval '2 minutes') RETURNING *`,
        );
        return object;
      },
      { isolationLevel: "read committed" },
    );
  }
  async enter(
    tx: DatabaseTransaction,
    userId: string,
    id: string,
    resolveConfig: () => AttachmentConfig,
    env: EnvSource,
  ) {
    // ByokStore already owns 41021407; final review and owner proof follow ALL waits.
    await this.lock(tx, userId);
    const [g] = await tx.execute<Generation>(
      sql`SELECT * FROM image_generation WHERE id=${id} AND user_id=${userId} AND state='reserved' AND NOT cancelled FOR UPDATE`,
    );
    if (!g) throw new AppError("image_cancelled", 409);
    await this.origin(tx, userId, g.request);
    const [object] = await tx.execute<ImageObject>(
      sql`SELECT * FROM image_object WHERE generation_id=${id} AND user_id=${userId} AND state='processing' AND upload_state='reserved' AND bytes=${imageLimits.bytes} AND lease_until>now() FOR UPDATE`,
    );
    const config = resolveConfig();
    await reservePrivateCapacity(tx, userId, 0, config, true);
    if (!object || object.bucket !== config.storage.bucket)
      throw new AppError("image_cancelled", 409);
    validateImageReview(g.request, imageSnapshot(env), g.model_snapshot);
    await tx.execute(
      sql`UPDATE image_generation SET state='entered',updated_at=now() WHERE id=${id}`,
    );
  }
  async status(userId: string, id: string): Promise<ImageStatus> {
    const [g] = await this.db.execute<Generation>(
      sql`SELECT * FROM image_generation WHERE id=${id} AND user_id=${userId}`,
    );
    if (!g) throw new AppError("not_found", 404);
    return {
      id: g.id,
      state: g.state,
      cancelled: g.cancelled,
      artifactId: g.state === "complete" ? g.artifact_id : null,
    };
  }
  async cancel(userId: string, id: string, env: EnvSource) {
    await this.db.transaction(async (tx) => {
      await this.lock(tx, userId);
      const [g] = await tx.execute<Generation>(
        sql`SELECT * FROM image_generation WHERE id=${id} AND user_id=${userId} FOR UPDATE`,
      );
      if (!g) throw new AppError("not_found", 404);
      if (
        g.state === "complete" ||
        g.state === "failed" ||
        g.state === "cancelled"
      )
        return;
      await tx.execute(
        sql`UPDATE image_generation SET cancelled=true,state=CASE WHEN state='reserved' THEN 'cancelled' ELSE 'held' END,updated_at=now() WHERE id=${id}`,
      );
      await tx.execute(
        sql`DELETE FROM image_object WHERE generation_id=${id} AND user_id=${userId} AND state='processing'`,
      );
      await tx.execute(
        sql`UPDATE byok_operation SET state=CASE WHEN state='reserved' THEN 'released' ELSE 'held' END,updated_at=now() WHERE id=${id} AND state IN ('reserved','entered','held')`,
      );
    });
    void env;
    return this.status(userId, id);
  }
  async enterUpload(userId: string, id: string) {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, userId);
      const [row] = await tx.execute<ImageObject>(
        sql`UPDATE image_object o SET upload_state='entered' FROM image_generation g WHERE o.generation_id=g.id AND g.id=${id} AND g.user_id=${userId} AND g.state='entered' AND NOT g.cancelled AND o.state='processing' AND o.upload_state='reserved' AND o.lease_until>now() RETURNING o.*`,
      );
      if (!row) throw new AppError("image_cancelled", 409);
      return row;
    });
  }
  async uploadTerminal(key: string) {
    await this.db.transaction(async (tx) => {
      await lockAttachments(tx);
      await tx.execute(
        sql`UPDATE image_object SET upload_state='terminal' WHERE object_key=${key} AND state='processing'`,
      );
      await tx.execute(
        sql`UPDATE attachment_delete_queue SET upload_state='terminal',not_before=now() WHERE object_key=${key}`,
      );
    });
  }
  async complete(
    userId: string,
    id: string,
    result: { bytes: Uint8Array; sha256: string },
  ) {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, userId);
      const [g] = await tx.execute<Generation>(
        sql`SELECT * FROM image_generation WHERE id=${id} AND user_id=${userId} AND state='entered' AND NOT cancelled FOR UPDATE`,
      );
      if (!g) throw new AppError("image_cancelled", 409);
      await this.origin(tx, userId, g.request);
      // Replacement/deletion after provider entry discards late output.
      const credentials = await tx.execute(
        sql`SELECT 1 FROM provider_credential WHERE user_id=${userId} AND provider='openrouter' AND revision=${g.request.credentialRevision}`,
      );
      if (!credentials[0]) throw new AppError("byok_key_changed", 409);
      const [o] = await tx.execute<ImageObject>(
        sql`SELECT * FROM image_object WHERE generation_id=${id} AND user_id=${userId} AND state='processing' AND upload_state='terminal' AND lease_until>now() FOR UPDATE`,
      );
      if (!o) throw new AppError("image_cancelled", 409);
      const provenance: ImageProvenance = {
        version: 1,
        operation: "generate",
        prompt: g.request.prompt,
        model: g.model_snapshot,
        inputs: [],
        object: {
          id: o.id,
          sha256: result.sha256,
          bytes: result.bytes.length,
          width: 1024,
          height: 1024,
          mediaType: "image/png",
        },
      };
      const content = JSON.stringify(provenance),
        version = g.expected_head + 1;
      const [usage] = await tx.execute<{ bytes: number }>(
        sql`SELECT coalesce(sum(octet_length(content)),0)::integer AS bytes FROM artifact_revision WHERE user_id=${userId}`,
      );
      if (usage.bytes + Buffer.byteLength(content) > artifactLimits.ownerBytes)
        throw new AppError("artifact_storage_limit", 409);
      if (!g.expected_head)
        await tx.execute(
          sql`INSERT INTO artifact(id,user_id,chat_id,message_id,kind,head) VALUES(${g.artifact_id},${userId},${g.chat_id},${g.message_id},'image',1)`,
        );
      else
        await tx.execute(
          sql`UPDATE artifact SET head=${version},updated_at=now() WHERE id=${g.artifact_id} AND user_id=${userId} AND head=${g.expected_head}`,
        );
      await tx.execute(
        sql`INSERT INTO artifact_revision(artifact_id,user_id,version,title,content) VALUES(${g.artifact_id},${userId},${version},${g.request.title},${content})`,
      );
      await tx.execute(
        sql`UPDATE image_object SET state='ready',artifact_id=${g.artifact_id},version=${version},bytes=${result.bytes.length},sha256=${result.sha256},lease_until=now() WHERE id=${o.id}`,
      );
      await tx.execute(
        sql`UPDATE image_generation SET state='complete',updated_at=now() WHERE id=${id}`,
      );
      await tx.execute(
        sql`UPDATE byok_operation SET state='complete',updated_at=now() WHERE id=${id} AND state='entered'`,
      );
      return { id: g.artifact_id, version };
    });
  }
  async fail(userId: string, id: string, entered: boolean) {
    await this.db.transaction(async (tx) => {
      await lockByokResources(tx);
      await lockAttachments(tx);
      await tx.execute(
        sql`UPDATE image_generation SET state=CASE WHEN ${entered} THEN 'held' ELSE 'failed' END,updated_at=now() WHERE id=${id} AND user_id=${userId} AND state IN ('reserved','entered')`,
      );
      await tx.execute(
        sql`DELETE FROM image_object WHERE generation_id=${id} AND user_id=${userId} AND state='processing'`,
      );
    });
  }
  async ownedRevision(
    userId: string,
    id: string,
    version: number,
    tx: Pick<Db, "execute"> = this.db,
  ) {
    const [row] = await tx.execute<
      ImageObject & { content: string; title: string }
    >(
      sql`SELECT o.*,r.content,r.title FROM artifact a JOIN artifact_revision r ON r.artifact_id=a.id AND r.user_id=a.user_id JOIN image_object o ON o.id=(r.content::jsonb->'object'->>'id') AND o.artifact_id=a.id AND o.user_id=a.user_id AND o.state='ready' WHERE a.id=${id} AND a.user_id=${userId} AND a.kind='image' AND r.version=${version}`,
    );
    if (!row) throw new AppError("not_found", 404);
    return row;
  }
  async reserveRead(
    userId: string,
    id: string,
    version: number,
    config: AttachmentConfig,
  ) {
    return this.db.transaction(async (tx) => {
      await lockAttachments(tx);
      const row = await this.ownedRevision(userId, id, version, tx);
      await reservePrivateTransfer(tx, row.bytes, config);
      return row;
    });
  }
  async recent(userId: string): Promise<ImageStatus[]> {
    const rows = await this.db.execute<Generation>(
      sql`SELECT * FROM image_generation WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 5`,
    );
    return rows.map((g) => ({
      id: g.id,
      state: g.state,
      cancelled: g.cancelled,
      artifactId: g.state === "complete" ? g.artifact_id : null,
    }));
  }
  /** A local timeout is never terminal evidence for remote provider work. */
  async recover() {
    await this.db.transaction(async (tx) => {
      await lockByokResources(tx);
      await lockAttachments(tx);
      await tx.execute(
        sql`UPDATE byok_operation b SET state=CASE WHEN b.state='reserved' THEN 'released' ELSE 'held' END,updated_at=now() FROM image_generation g JOIN image_object o ON o.generation_id=g.id WHERE b.id=g.id AND g.state IN ('reserved','entered') AND o.state='processing' AND o.lease_until<=now() AND b.state IN ('reserved','entered','held')`,
      );
      await tx.execute(
        sql`UPDATE image_generation g SET state=CASE WHEN g.state='reserved' THEN 'failed' ELSE 'held' END,updated_at=now() FROM image_object o WHERE o.generation_id=g.id AND g.state IN ('reserved','entered') AND o.state='processing' AND o.lease_until<=now()`,
      );
      await tx.execute(
        sql`DELETE FROM image_object WHERE state='processing' AND lease_until<=now()`,
      );
    });
  }
  async export(userId: string) {
    const generations = await this.db.execute(
      sql`SELECT id,chat_id,message_id,artifact_id,expected_head,request,model_snapshot,state,cancelled,created_at,updated_at FROM image_generation WHERE user_id=${userId} ORDER BY created_at`,
    );
    const objects = await this.db.execute(
      sql`SELECT id,generation_id,artifact_id,version,bytes,state,upload_state,sha256,width,height,media_type,created_at FROM image_object WHERE user_id=${userId} ORDER BY created_at`,
    );
    return { generations, objects };
  }
}
