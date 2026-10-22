import { isIP } from "node:net";
import { fail, integer, object, text } from "./errors.js";
export const PURPOSES = [
  "mcp.initialize",
  "mcp.list",
  "mcp.call",
  "mcp.cancel",
  "oauth.resource",
  "oauth.discovery",
  "oauth.token",
  "oauth.refresh",
  "oauth.revoke",
] as const;
export type Purpose = (typeof PURPOSES)[number];
export type Profile = Readonly<{
  profileId: string;
  revision: string;
  purpose: Purpose;
  endpoint: string;
  hostname: string;
  port: number;
  path: string;
  method: "GET" | "POST";
  contentType: "application/json" | "application/x-www-form-urlencoded";
  responseTypes: readonly string[];
  maxRequestBytes: number;
  maxResponseBytes: number;
  timeoutMs: number;
  connectMs: number;
  firstByteMs: number;
  resource: string;
  issuer: string;
  credential: "none" | "bearer" | "refresh" | "revoke";
  clientSecretRef?: string;
  formFields: Readonly<Record<string, string>>;
}>;
const id = /^[a-zA-Z0-9_-]{1,80}$/;
export function identifier(value: unknown): string {
  const result = text(value, 80);
  if (!id.test(result)) fail("invalid_request");
  return result;
}
export function purpose(value: unknown): Purpose {
  if (!PURPOSES.includes(value as Purpose)) fail("invalid_request");
  return value as Purpose;
}
export function endpoint(value: unknown): URL {
  const raw = text(value, 2048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("configuration");
  }
  const host = url.hostname;
  // Fixed canonical ASCII DNS names only: no IDNA, literals, trailing dot, query,
  // percent escapes, userinfo, fragment, dot-segment or alternate-port spelling.
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    isIP(host) ||
    host.includes(":") ||
    host.endsWith(".") ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(
      host,
    ) ||
    host.split(".").some((label) => label.startsWith("xn--")) ||
    /\.(localhost|local|internal|invalid|test)$/.test(host) ||
    !/^\/[a-zA-Z0-9/_~.-]*$/.test(url.pathname) ||
    url.pathname.includes("//") ||
    raw !== `${url.origin}${url.pathname}`
  )
    fail("configuration");
  return url;
}
export function parseProfiles(value: unknown): readonly Profile[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32)
    fail("configuration");
  const seen = new Set<string>();
  try {
    return Object.freeze(
      value.map((item) => {
        const p = object(item, [
          "profileId",
          "revision",
          "purpose",
          "endpoint",
          "contentType",
          "responseTypes",
          "maxRequestBytes",
          "maxResponseBytes",
          "timeoutMs",
          "connectMs",
          "firstByteMs",
          "resource",
          "issuer",
          "credential",
          "clientSecretRef",
          "formFields",
        ]);
        const url = endpoint(p.endpoint);
        const kind = purpose(p.purpose);
        const key = `${identifier(p.profileId)}:${identifier(p.revision)}:${kind}`;
        if (seen.has(key)) fail("configuration");
        seen.add(key);
        const contentType = p.contentType;
        if (
          contentType !== "application/json" &&
          contentType !== "application/x-www-form-urlencoded"
        )
          fail("configuration");
        if (kind.startsWith("mcp.") && contentType !== "application/json")
          fail("configuration");
        if (
          !Array.isArray(p.responseTypes) ||
          p.responseTypes.length === 0 ||
          p.responseTypes.length > 2 ||
          p.responseTypes.some(
            (t) => t !== "application/json" && t !== "text/event-stream",
          )
        )
          fail("configuration");
        if (
          kind.startsWith("oauth.") &&
          (p.responseTypes.length !== 1 ||
            p.responseTypes[0] !== "application/json")
        )
          fail("configuration");
        if (
          !["none", "bearer", "refresh", "revoke"].includes(
            p.credential as string,
          )
        )
          fail("configuration");
        const expected =
          kind === "oauth.refresh"
            ? "refresh"
            : kind === "oauth.revoke"
              ? "revoke"
              : kind.startsWith("oauth.")
                ? "none"
                : p.credential;
        if (
          p.credential !== expected ||
          (kind.startsWith("mcp.") &&
            !["none", "bearer"].includes(p.credential as string))
        )
          fail("configuration");
        if (
          ["oauth.token", "oauth.refresh", "oauth.revoke"].includes(kind) &&
          contentType !== "application/x-www-form-urlencoded"
        )
          fail("configuration");
        const issuer = endpoint(p.issuer).href;
        const resource = endpoint(p.resource).href;
        const timeoutMs = integer(p.timeoutMs, 1, 20_000);
        const fields: Record<string, string> = {};
        const rawFields =
          p.formFields === undefined
            ? {}
            : object(p.formFields, ["client_id", "redirect_uri", "scope"]);
        for (const [name, value] of Object.entries(rawFields)) {
          fields[name] = text(value, 2048);
          if (!/^[\x20-\x7e]+$/.test(fields[name])) fail("configuration");
          if (name === "redirect_uri") endpoint(value);
        }
        if (["oauth.token", "oauth.refresh", "oauth.revoke"].includes(kind)) {
          if (
            !fields.client_id ||
            (kind === "oauth.token" && !fields.redirect_uri)
          )
            fail("configuration");
          if (kind !== "oauth.token" && fields.redirect_uri)
            fail("configuration");
        } else if (Object.keys(fields).length) fail("configuration");
        const secret =
          p.clientSecretRef === undefined
            ? undefined
            : identifier(p.clientSecretRef);
        if (
          secret &&
          !["oauth.token", "oauth.refresh", "oauth.revoke"].includes(kind)
        )
          fail("configuration");
        return Object.freeze({
          profileId: identifier(p.profileId),
          revision: identifier(p.revision),
          purpose: kind,
          endpoint: url.href,
          hostname: url.hostname,
          port: Number(url.port || 443),
          path: url.pathname,
          method:
            kind === "oauth.resource" || kind === "oauth.discovery"
              ? "GET"
              : "POST",
          contentType,
          responseTypes: Object.freeze([
            ...p.responseTypes,
          ]) as readonly string[],
          maxRequestBytes: integer(p.maxRequestBytes, 0, 65_536),
          maxResponseBytes: integer(p.maxResponseBytes, 1, 65_536),
          timeoutMs,
          connectMs: integer(p.connectMs, 1, timeoutMs),
          firstByteMs: integer(p.firstByteMs, 1, timeoutMs),
          issuer,
          resource,
          formFields: Object.freeze(fields),
          credential: p.credential as Profile["credential"],
          ...(secret ? { clientSecretRef: secret } : {}),
        });
      }),
    );
  } catch {
    fail("configuration");
  }
}
