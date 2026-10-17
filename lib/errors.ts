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
  process.stderr.write(`${JSON.stringify({ level: "error", id })}\n`);
}
