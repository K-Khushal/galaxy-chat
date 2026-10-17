/** Only a deliberately configured HTTP(S) origin may become a public canonical. */
export function publicSiteOrigin(
  value: string | undefined,
): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return undefined;
    if (
      url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}
