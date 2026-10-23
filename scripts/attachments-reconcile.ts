import { AttachmentStore } from "../lib/attachments/store";
import { closeDb } from "../lib/db/client";

// Explicit operator reconciliation, never called by an HTTP route or timeout.
// Keep the provider-supported terminal/bounded-write proof in operator records;
// pass its SHA-256 so the database audit can refer to that exact evidence.
const [objectKey, evidenceSha256, confirmation] = process.argv.slice(2);
try {
  if (
    confirmation !== "--provider-upload-is-terminal" ||
    !objectKey ||
    !evidenceSha256
  )
    throw new Error("confirmation_required");
  await new AttachmentStore().reconcileUnknown(objectKey, evidenceSha256);
  process.stdout.write('{"reconciled":true}\n');
} catch {
  process.stderr.write('{"error":"attachment_reconciliation_failed"}\n');
  process.exitCode = 1;
} finally {
  await closeDb();
}
