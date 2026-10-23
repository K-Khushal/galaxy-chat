import type { FileDescription } from "@/lib/attachments/content";
import { attachmentLimits } from "@/lib/attachments/contract";
import { AppError } from "@/lib/errors";
export type Extraction = { text: string; pages: number | null };
function checkedText(text: string) {
  if (text.length > attachmentLimits.extractedCharacters)
    throw new AppError("attachment_text_limit", 413);
  return text.replaceAll("\0", "");
}
/** Never render annotations, follow links, evaluate scripts, or perform OCR. */
export async function extractAttachment(
  file: FileDescription,
  bytes: Uint8Array,
  parentSignal: AbortSignal,
): Promise<Extraction> {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(10_000)]);
  signal.throwIfAborted();
  if (file.kind === "image") return { text: "", pages: null };
  if (file.kind !== "pdf")
    return {
      text: checkedText(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ),
      pages: null,
    };
  const { getResolvedPDFJS } = await import("unpdf");
  const pdfjs = await getResolvedPDFJS();
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    useWasm: false,
    enableXfa: false,
    maxImageSize: attachmentLimits.imagePixels,
    stopAtErrors: true,
    disableAutoFetch: true,
    disableStream: true,
    verbosity: 0,
  });
  const abort = () => {
    void task.destroy().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const pdf = await task.promise;
    if (pdf.numPages > attachmentLimits.pages)
      throw new AppError("attachment_page_limit", 413);
    const pages: string[] = [];
    let length = 0;
    for (let index = 1; index <= pdf.numPages; index++) {
      signal.throwIfAborted();
      const page = await pdf.getPage(index);
      const reader = page
        .streamTextContent({ disableNormalization: false })
        .getReader();
      const parts: string[] = [];
      try {
        while (true) {
          signal.throwIfAborted();
          const { value, done } = await reader.read();
          if (done) break;
          for (const item of value.items)
            if ("str" in item) {
              length += item.str.length + 1;
              if (length > attachmentLimits.extractedCharacters)
                throw new AppError("attachment_text_limit", 413);
              parts.push(item.str, item.hasEOL ? "\n" : " ");
            }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
        page.cleanup();
      }
      pages.push(`[Page ${index}]\n${parts.join("").trim()}`);
    }
    if (!pages.some((page) => page.replace(/\[Page \d+\]/, "").trim()))
      throw new AppError("attachment_no_text_no_ocr", 422);
    return { text: checkedText(pages.join("\n\n")), pages: pdf.numPages };
  } catch (error) {
    if (signal.aborted && !parentSignal.aborted)
      throw new AppError("attachment_processing_timeout", 408);
    if (error instanceof AppError || signal.aborted) throw error;
    throw new AppError("attachment_pdf_unreadable", 422);
  } finally {
    signal.removeEventListener("abort", abort);
    await task.destroy().catch(() => {});
  }
}
