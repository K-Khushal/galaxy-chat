import type { NextConfig } from "next";

import { testE2eEnabled } from "./lib/env";

testE2eEnabled(process.env);

const nextConfig: NextConfig = { devIndicators: false };

export default nextConfig;
