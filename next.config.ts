import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { observabilityEnv, testE2eEnabled } from "./lib/env";

testE2eEnabled(process.env);
const env = observabilityEnv();
const nextConfig: NextConfig = {
  devIndicators: false,
  env: {
    NEXT_PUBLIC_SENTRY_DSN: env.SENTRY_DSN ?? "",
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: env.SENTRY_ENVIRONMENT ?? "",
  },
};
export default withSentryConfig(nextConfig, {
  silent: true,
  authToken: env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !env.SENTRY_AUTH_TOKEN },
});
