import { attachmentCleanupConfig } from "../lib/attachments/config";
import { AttachmentService } from "../lib/attachments/service";
import { closeDb } from "../lib/db/client";

// Run from an operator-controlled server environment with the same private bucket.
// Never put a cleanup credential or this operation on a public HTTP endpoint.
try {
  const result = await new AttachmentService(attachmentCleanupConfig()).cleanup(
    20,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write('{"error":"attachment_cleanup_failed"}\n');
  process.exitCode = 1;
} finally {
  await closeDb();
}
