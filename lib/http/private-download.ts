function encodedFilename(filename: string) {
  return encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function privateDownloadHeaders({
  contentType,
  filename,
  length,
  fallback = "download",
}: {
  contentType: string;
  filename: string;
  length: number;
  fallback?: string;
}) {
  const safeFallback =
    fallback.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100) || "download";
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${safeFallback}"; filename*=UTF-8''${encodedFilename(filename)}`,
    "Content-Length": String(length),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Referrer-Policy": "no-referrer",
  };
}
