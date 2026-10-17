import type { AttachmentStorage } from "../../lib/attachments/storage";
export class MemoryAttachmentStorage implements AttachmentStorage {
  readonly objects = new Map<string, Uint8Array>();
  uploaded = 0;
  downloaded = 0;
  deleted = 0;
  private = true;
  unknownUpload = false;
  failDelete = false;
  async assertPrivate() {
    if (!this.private) throw new Error("fixture_public_bucket");
  }
  async upload(key: string, bytes: Uint8Array) {
    this.objects.set(key, bytes.slice());
    this.uploaded++;
    if (this.unknownUpload) throw new Error("fixture_unknown_write");
  }
  async download(key: string, max: number) {
    const bytes = this.objects.get(key);
    if (!bytes || bytes.length > max) throw new Error("fixture_missing");
    this.downloaded++;
    return bytes.slice();
  }
  async remove(key: string) {
    if (this.failDelete) throw new Error("fixture_delete_failed");
    this.objects.delete(key);
    this.deleted++;
  }
}
export const attachmentConfigFixture = {
  storage: {
    url: "https://fixture.supabase.co",
    secretKey: "nonfunctional-storage-fixture-secret",
    bucket: "private",
  },
  platformBytes: 100_000,
  userBytes: 50_000,
  dailyTransferBytes: 5_000_000,
};
/** Small, actual local PDF fixture with one text stream per page. */
export function pdfFixture(texts: string[]) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${texts.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${texts.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let i = 0; i < texts.length; i++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    const text = texts[i].replace(/[()\\]/g, " ");
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(output.length);
    output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(output);
}
export const pngFixture = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9lEAAAAASUVORK5CYII=",
    "base64",
  ),
);
