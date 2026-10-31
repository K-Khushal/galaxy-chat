import "server-only";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type StorageEnv, storageEnv } from "@/lib/env";

/** An object changed after it was checked: a conditional read failed. */
export class ObjectChangedError extends Error {
  constructor() {
    super("object changed");
  }
}

const isPreconditionFailed = (error: unknown) =>
  (error as { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode === 412;

/** What the app needs from object storage. Tests inject an in-memory one. */
export type ObjectStorage = {
  /**
   * A URL the browser PUTs the file to; the type and length are signed in.
   * If-None-Match: * is signed and required: the final key is create-once.
   */
  presignPut(
    key: string,
    options: {
      contentType: string;
      contentLength: number;
      expiresIn: number;
      signingDate?: Date;
    },
  ): Promise<string>;
  /** A short-lived URL for reading an object, with the response headers set. */
  presignGet(
    key: string,
    options: {
      contentType: string;
      disposition: string;
      expiresIn: number;
    },
  ): Promise<string>;
  /** The object's size, content type and ETag, or null when it is missing. */
  head(
    key: string,
  ): Promise<{ size: number; contentType: string; etag: string } | null>;
  /**
   * Bytes `start` to `end` inclusive (fewer when the object is shorter). With
   * `ifMatch`, throws ObjectChangedError if the object is no longer that ETag.
   */
  read(
    key: string,
    range: { start: number; end: number },
    ifMatch?: string,
  ): Promise<Uint8Array>;
  /** Deletes objects; missing ones are not an error. */
  remove(keys: string[]): Promise<void>;
};

const DELETE_BATCH = 1000;

/** Cloudflare R2 through its S3 API. Signs against the S3 endpoint. */
export function r2Storage(env: StorageEnv): ObjectStorage {
  const client = new S3Client({
    region: "auto",
    forcePathStyle: true,
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    // R2 rejects the optional checksum headers newer SDKs add by default.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = env.R2_BUCKET;
  return {
    presignPut: (key, { contentType, contentLength, expiresIn, signingDate }) =>
      getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: contentLength,
          IfNoneMatch: "*",
        }),
        {
          expiresIn,
          signingDate,
          signableHeaders: new Set([
            "content-type",
            "content-length",
            "if-none-match",
          ]),
        },
      ),
    presignGet: (key, { contentType, disposition, expiresIn }) =>
      getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentType: contentType,
          ResponseContentDisposition: disposition,
        }),
        { expiresIn },
      ),
    async head(key) {
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket, Key: key }),
        );
        return {
          size: head.ContentLength ?? 0,
          contentType: head.ContentType ?? "",
          etag: head.ETag ?? "",
        };
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode === 404
        ) {
          return null;
        }
        throw error;
      }
    },
    async read(key, { start, end }, ifMatch) {
      try {
        const object = await client.send(
          new GetObjectCommand({
            Bucket,
            Key: key,
            Range: `bytes=${start}-${end}`,
            IfMatch: ifMatch,
          }),
        );
        if (!object.Body) return new Uint8Array();
        return await object.Body.transformToByteArray();
      } catch (error) {
        if (isPreconditionFailed(error)) throw new ObjectChangedError();
        throw error;
      }
    },
    async remove(keys) {
      for (let index = 0; index < keys.length; index += DELETE_BATCH) {
        const batch = keys.slice(index, index + DELETE_BATCH);
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        if (result.Errors?.length) throw new Error("object delete failed");
      }
    },
  };
}

/**
 * Storage that reads R2's variables on first use, so routes and builds that
 * never touch an Attachment need none of them.
 */
export function lazyStorage(): ObjectStorage {
  let storage: ObjectStorage | undefined;
  const get = () => {
    storage ??= r2Storage(storageEnv());
    return storage;
  };
  return {
    presignPut: (...args) => get().presignPut(...args),
    presignGet: (...args) => get().presignGet(...args),
    head: (...args) => get().head(...args),
    read: (...args) => get().read(...args),
    remove: (...args) => get().remove(...args),
  };
}
