import { z } from "zod";

export const guestViewSchema = z
  .object({
    state: z.enum(["available", "used", "busy", "disabled"]),
    remainingGenerations: z.number().int().min(0).max(1),
    reason: z
      .enum([
        "shared_exhausted",
        "daily_exhausted",
        "guest_unconfigured",
        "funded_inference_disabled",
      ])
      .catch("guest_unconfigured")
      .optional(),
    siteKey: z
      .string()
      .regex(/^[A-Za-z0-9_-]{3,100}$/)
      .optional(),
  })
  .transform((value) =>
    value.state === "available" &&
    (!value.siteKey || value.remainingGenerations !== 1)
      ? { state: "disabled" as const, remainingGenerations: 0 }
      : value,
  );
export type GuestView = z.infer<typeof guestViewSchema>;
export const unavailableGuest: GuestView = {
  state: "disabled",
  remainingGenerations: 0,
};
export const GUEST_OUTPUT_LIMIT = 32_000;
export function guestErrorMessage(id: string) {
  switch (id) {
    case "guest_limit_reached":
      return "Your guest generation has been used. Sign in to continue if you have a beta invitation.";
    case "guest_verification_required":
      return "Verification expired or failed. Complete a new check before sending.";
    case "daily_exhausted":
      return "The daily allowance is used. Sign in to check your access and reset time.";
    case "shared_exhausted":
      return "The shared allowance is paused. Please try again later.";
    case "guest_rate_limited":
      return "Too many verification attempts. Please try again later.";
    case "context_too_large":
      return "Shorten your prompt to fit the text limit, then verify again.";
    case "funding_busy":
      return "Another request is in progress. Check availability again shortly.";
    default:
      return "The response could not finish. Check availability before trying again; your guest generation may have been used.";
  }
}

export function guestPromptBytes(text: string) {
  return new TextEncoder().encode(JSON.stringify(text.trim())).length;
}
