/** Server-derived availability belongs here when F05/F06 are connected. */
export type ChatAvailability =
  | { state: "unavailable"; reason: string }
  | { state: "ready"; funding: "platform" | "byok" };

export const defaultAvailability: ChatAvailability = {
  state: "unavailable",
  reason:
    "Generation is paused while model access and spending controls are connected.",
};

export function uiHarnessEnabled(env: Record<string, string | undefined>) {
  return env.NODE_ENV === "development" && env.F04_UI_HARNESS === "1";
}
