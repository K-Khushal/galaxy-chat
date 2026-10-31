import "server-only";
import { eq, inArray } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import {
  attachmentIdFromUrl,
  INLINE_TEXT_LIMIT,
  modelSupport,
} from "@/lib/attachments/rules";
import {
  type AttachmentDeps,
  type AttachmentRow,
  objectKey,
} from "@/lib/attachments/store";
import { attachment } from "@/lib/db/schema";
import { logErrorId } from "@/lib/errors";
import type { ResolvedModel } from "@/lib/models";

/** How long a read URL given to the model lasts; a Generation runs at most 5 minutes. */
const MODEL_URL_SECONDS = 15 * 60;
/** Enough bytes for INLINE_TEXT_LIMIT characters of any UTF-8 text. */
const TEXT_READ_BYTES = INLINE_TEXT_LIMIT * 4;

type Part = { type: string; [key: string]: unknown };
type Entry = { role: "user" | "assistant"; parts: Part[] };

/** Text of a PDF, or null when it cannot be read. */
export async function extractPdfText(
  bytes: Uint8Array,
): Promise<string | null> {
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return text.trim();
  } catch {
    return null;
  }
}

const quoteAttribute = (value: string) =>
  value.replace(/[&"<>\n\r]/g, (char) =>
    char === "&" ? "&amp;" : char === '"' ? "&quot;" : " ",
  );

/** A file's text for the model, with its name and a note when cut short. */
function inlineText(filename: string, text: string, note?: string): Part {
  const cut = text.length > INLINE_TEXT_LIMIT;
  const body = cut ? text.slice(0, INLINE_TEXT_LIMIT) : text;
  const truncated = cut
    ? `\n[Only the first ${INLINE_TEXT_LIMIT.toLocaleString("en-US")} characters are shown.]`
    : "";
  return {
    type: "text",
    text: `<attachment filename="${quoteAttribute(filename)}"${note ? ` note="${note}"` : ""}>\n${body}${truncated}\n</attachment>`,
  };
}

const unavailable = (filename: string): Part => ({
  type: "text",
  text: `[Attachment "${quoteAttribute(filename)}" is no longer available.]`,
});

async function pdfText(
  deps: AttachmentDeps,
  row: AttachmentRow,
): Promise<string | null> {
  if (row.extractedText !== null) return row.extractedText;
  // The whole file: a PDF cannot be read from a prefix.
  const bytes = await deps.storage.read(objectKey(row.userId, row.id), {
    start: 0,
    end: row.size - 1,
  });
  const text = await extractPdfText(bytes);
  if (text === null) return null;
  const capped = text.slice(0, INLINE_TEXT_LIMIT + 1);
  await deps.db
    .update(attachment)
    .set({ extractedText: capped })
    .where(eq(attachment.id, row.id))
    .catch(() => logErrorId("attachment_text_cache_failed"));
  return capped;
}

/** The part(s) the model gets for one stored file part. */
async function resolvePart(
  deps: AttachmentDeps,
  row: AttachmentRow,
  support: ReturnType<typeof modelSupport>,
): Promise<Part> {
  const key = objectKey(row.userId, row.id);
  if (row.kind === "image") {
    if (!support.vision) {
      return {
        type: "text",
        text: `[Image "${quoteAttribute(row.filename)}" was attached, but ${support.label} cannot read images.]`,
      };
    }
    return {
      type: "file",
      mediaType: row.contentType,
      filename: row.filename,
      url: await deps.storage.presignGet(key, {
        contentType: row.contentType,
        disposition: "inline",
        expiresIn: MODEL_URL_SECONDS,
      }),
    };
  }
  if (row.kind === "pdf") {
    if (support.pdf) {
      return {
        type: "file",
        mediaType: "application/pdf",
        filename: row.filename,
        url: await deps.storage.presignGet(key, {
          contentType: row.contentType,
          disposition: "inline",
          expiresIn: MODEL_URL_SECONDS,
        }),
      };
    }
    const text = await pdfText(deps, row);
    return text
      ? inlineText(row.filename, text, "text extracted from a PDF")
      : {
          type: "text",
          text: `[PDF "${quoteAttribute(row.filename)}" was attached, but no text could be read from it.]`,
        };
  }
  const bytes = await deps.storage.read(key, {
    start: 0,
    end: Math.min(row.size, TEXT_READ_BYTES) - 1,
  });
  return inlineText(row.filename, new TextDecoder().decode(bytes));
}

/**
 * Turns a history's stored file parts (links to Attachments) into what the
 * model reads: short-lived read URLs for images and, where supported, PDFs;
 * text for everything else. Runs on every Generation start, so a regenerated,
 * continued or resumed Reply gets fresh URLs. Files that are gone become a
 * note. Only the User's own files resolve.
 */
export async function resolveAttachments(
  deps: AttachmentDeps,
  input: { userId: string; model: ResolvedModel },
  history: Entry[],
): Promise<Entry[]> {
  const ids = new Set<string>();
  for (const entry of history) {
    for (const part of entry.parts) {
      const id =
        part.type === "file" && typeof part.url === "string"
          ? attachmentIdFromUrl(part.url)
          : null;
      if (id) ids.add(id);
    }
  }
  if (ids.size === 0) return history;
  const rows = await deps.db
    .select()
    .from(attachment)
    .where(inArray(attachment.id, [...ids]));
  const owned = new Map(
    rows
      .filter((row) => row.userId === input.userId)
      .map((row) => [row.id, row]),
  );
  const support = modelSupport(
    input.model.catalog?.capabilities ?? null,
    input.model.catalog?.label ?? input.model.id,
  );
  return Promise.all(
    history.map(async (entry) => ({
      ...entry,
      parts: await Promise.all(
        entry.parts.map(async (part) => {
          const id =
            part.type === "file" && typeof part.url === "string"
              ? attachmentIdFromUrl(part.url)
              : null;
          if (!id) return part;
          const row = owned.get(id);
          if (!row || row.status !== "ready") {
            return unavailable(String(part.filename ?? "file"));
          }
          return resolvePart(deps, row, support);
        }),
      ),
    })),
  );
}
