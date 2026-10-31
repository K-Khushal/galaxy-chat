import * as Sentry from "@sentry/nextjs";
import { log } from "@/lib/logger";
export class AppError extends Error {
  readonly id: string;
  readonly status: number;

  constructor(id: string, status: number) {
    super(id);
    this.name = "AppError";
    this.id = id;
    this.status = status;
  }
}

export function logErrorId(id: string) {
  if (id !== "internal_error") {
    log("warn", id);
    return;
  }
  log("error", id);
  Sentry.captureException(new Error(id), { tags: { errorId: id } });
}
