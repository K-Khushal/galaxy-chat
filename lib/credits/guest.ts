import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { EnvSource } from "@/lib/auth/env";
import { AppError } from "@/lib/errors";
import { resolveFundingConfig } from "./config";
import { actorFor } from "./store";

const COOKIE = "__Host-galaxy-guest";
const AGE = 365 * 24 * 60 * 60;
export type GuestConfig = {
  secret: string;
  turnstileSecret: string;
  siteKey: string;
  origin: string;
  hostname: string;
};
export function guestConfig(env: EnvSource): GuestConfig {
  resolveFundingConfig(env);
  const secret = env.GUEST_COOKIE_SECRET;
  const turnstileSecret = env.GUEST_TURNSTILE_SECRET;
  const siteKey = env.GUEST_TURNSTILE_SITE_KEY;
  // The origin MUST only be accessible through Cloudflare, which strips/sets
  // CF-Connecting-IP. Never trust arbitrary X-Forwarded-For or a public origin.
  if (
    !secret ||
    secret.length < 32 ||
    !turnstileSecret ||
    !siteKey ||
    !/^[A-Za-z0-9_-]{3,100}$/.test(siteKey) ||
    env.GUEST_TRUSTED_PROXY !== "cloudflare" ||
    env.GUEST_ORIGIN_IS_PROXY_ONLY !== "1"
  )
    throw new AppError("guest_unconfigured", 503);
  let url: URL;
  try {
    url = new URL(env.BETTER_AUTH_URL ?? "");
  } catch {
    throw new AppError("guest_unconfigured", 503);
  }
  if (url.protocol !== "https:") throw new AppError("guest_unconfigured", 503);
  return {
    secret,
    turnstileSecret,
    siteKey,
    origin: url.origin,
    hostname: url.hostname,
  };
}
function signature(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}
export function signedGuest(secret: string, now = new Date()) {
  const body = `${crypto.randomUUID()}.${Math.floor(now.getTime() / 1000) + AGE}`;
  return `${body}.${signature(body, secret)}`;
}
export function guestId(
  headers: Headers,
  secret: string,
  now = new Date(),
): string | undefined {
  const cookie = headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!cookie || cookie.length > 160) return;
  const match = /^([a-f0-9-]{36})\.(\d{10})\.([a-f0-9]{64})$/.exec(cookie);
  if (
    !match ||
    Number(match[2]) <= now.getTime() / 1000 ||
    Number(match[2]) > now.getTime() / 1000 + AGE + 60
  )
    return;
  const expected = signature(`${match[1]}.${match[2]}`, secret);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(match[3]))) return;
  return match[1];
}
export function guestCookie(value: string) {
  return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${AGE}`;
}
export function guestNetwork(headers: Headers, secret: string) {
  const ip = headers.get("cf-connecting-ip")?.trim() ?? "";
  if (!isIP(ip)) throw new AppError("guest_verification_required", 403);
  // Coarsen IPv6 network identity to its /64 to reduce rotating-address abuse.
  // IPv4-mapped addresses and normalization are handled by the trusted edge.
  let network = ip;
  if (ip.includes(":")) {
    const normalized = new URL(`http://[${ip}]/`).hostname.replace(
      /[[\]]/g,
      "",
    );
    const [left, right] = normalized.split("::");
    const start = left ? left.split(":") : [];
    const end = right ? right.split(":") : [];
    const expanded =
      right !== undefined
        ? [...start, ...Array(8 - start.length - end.length).fill("0"), ...end]
        : start;
    network = expanded
      .slice(0, 4)
      .map((piece) => piece.padStart(4, "0"))
      .join(":");
  }
  return { ip, key: actorFor("guest", `network:${network}`, secret).key };
}
export async function verifyGuestBot(
  config: GuestConfig,
  token: string,
  ip: string,
  requestId: string,
) {
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: config.turnstileSecret,
          response: token,
          remoteip: ip,
          idempotency_key: requestId,
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) throw new Error("verification failed");
    const value: unknown = await response.json();
    if (
      !value ||
      typeof value !== "object" ||
      !("success" in value) ||
      value.success !== true ||
      !("hostname" in value) ||
      value.hostname !== config.hostname ||
      !("action" in value) ||
      value.action !== "galaxy_guest"
    )
      throw new Error("verification failed");
  } catch {
    throw new AppError("guest_verification_required", 403);
  }
}
