import "server-only";
import { pathToFileURL } from "node:url";
import { testE2eEnabled } from "@/lib/env";

/** Kept outside Next's dependency graph and deployment output. */
export async function loadE2eSeams(): Promise<typeof import("./e2e-seams")> {
  if (!testE2eEnabled()) throw new Error("E2E seams are disabled");
  const url = pathToFileURL(
    `${process.cwd()}/tests/e2e/.runtime/seams.mjs`,
  ).href;
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
}
