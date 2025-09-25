import { z } from "zod";

export const forgotPasswordSchema = z.object({
    email: z.email("Enter a valid email"),
});

export const verifySchema = z.object({
    otp: z.string().regex(/^\d+$/, "OTP must contain only numbers").length(6, "OTP must be 6 digits"),
    password: z.string().min(8, "Password must be at least 8 characters"),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type VerifyInput = z.infer<typeof verifySchema>;

