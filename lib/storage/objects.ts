import { AppError } from "@/lib/errors";

const OBJECT_KEY = /^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/;

export function assertOwnedObjectKey(userId: string, key: string) {
  if (!OBJECT_KEY.test(key)) {
    throw new AppError("invalid_object", 400);
  }
  const owner = key.slice(0, key.indexOf("/"));
  if (owner !== userId) {
    throw new AppError("forbidden", 403);
  }
}
