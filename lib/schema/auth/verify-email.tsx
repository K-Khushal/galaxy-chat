import { z } from "zod";

export const VerifyEmailSchema = z.object({
  email: z.email("Invalid email"),
  otp: z
    .string()
    .regex(/^\d+$/, "OTP must contain only numbers")
    .length(6, "OTP must be 6 digits"),
});

export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;
