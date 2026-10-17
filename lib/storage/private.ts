import "server-only";

export type PrivateStorageConfig = {
  url: string;
  secretKey: string;
  bucket: string;
};

/**
 * The storage secret stays on the server. Do not read it from a client
 * component or copy it into a NEXT_PUBLIC variable.
 */
export function privateStorageConfig(): PrivateStorageConfig | null {
  const url = process.env.SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim();
  if (!url || !secretKey || !bucket) {
    return null;
  }
  return { url, secretKey, bucket };
}
