import { type NextRequest, NextResponse } from "next/server";
import { observabilityEnv, testE2eEnabled } from "./lib/env";
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const env = observabilityEnv(process.env);
  const dev = process.env.NODE_ENV !== "production";
  // The E2E suite serves a production build over plain http on 127.0.0.1, so
  // HTTPS-only directives would break it. testE2eEnabled never holds in production.
  const https = !dev && !testE2eEnabled(process.env);
  const connect = [
    "'self'",
    "https://challenges.cloudflare.com",
    ...(dev ? ["ws:", "http://localhost:*"] : []),
    ...(env.SENTRY_DSN ? [new URL(env.SENTRY_DSN).origin] : []),
    ...(env.R2_ACCOUNT_ID
      ? [`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`]
      : []),
  ];
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com ${dev ? "'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://avatars.githubusercontent.com https://lh3.googleusercontent.com ${env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : ""}; font-src 'self'; connect-src ${connect.join(" ")}; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; ${https ? "upgrade-insecure-requests;" : ""}`;
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (https)
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    );
  return response;
}
export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
