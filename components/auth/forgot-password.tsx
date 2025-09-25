"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { PasswordInput } from "@/components/ui/input-password";
import { forgotPasswordSchema, verifySchema, type ForgotPasswordInput, type VerifyInput } from "@/lib/schema/auth/forgot-password";
import { useClerk, useSignIn } from "@clerk/nextjs";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

export default function ForgotPasswordForm() {
    const router = useRouter();
    const { isLoaded, signIn } = useSignIn();
    const { signOut } = useClerk();
    const [stage, setStage] = useState<"request" | "verify">("request");

    const requestForm = useForm<ForgotPasswordInput>({
        resolver: zodResolver(forgotPasswordSchema),
        mode: "onChange",
        defaultValues: { email: "" },
    });

    const verifyForm = useForm<VerifyInput>({
        resolver: zodResolver(verifySchema),
        mode: "onChange",
        defaultValues: { otp: "", password: "" },
    });

    async function onRequest(data: ForgotPasswordInput) {
        if (!isLoaded || !signIn) {
            toast.error("System not ready", { description: "Please wait a moment and try again." });
            return;
        }

        const identifier = data.email.trim().toLowerCase();
        const validation = forgotPasswordSchema.safeParse({ email: identifier });
        if (!validation.success) {
            toast.error("Validation failed", { description: "Please enter a valid email." });
            return;
        }

        try {
            await signIn.create({ strategy: "reset_password_email_code", identifier });
            toast.success("Reset email sent", { description: "Check your inbox for the code." });
            setStage("verify");
        } catch (err: any) {
            const clerkError = err?.errors?.[0];
            const message = clerkError?.longMessage ?? "Unable to send reset code";
            toast.error("Request failed", { description: message });
        }
    }

    async function onVerify(data: VerifyInput) {
        if (!isLoaded || !signIn) {
            toast.error("System not ready", { description: "Please wait a moment and try again." });
            return;
        }

        const parsed = verifySchema.safeParse(data);
        if (!parsed.success) {
            toast.error("Validation failed", { description: "Please check your inputs and try again." });
            return;
        }

        try {
            // 1) Attempt first factor with the email code
            const attempt = await signIn.attemptFirstFactor({
                strategy: "reset_password_email_code",
                code: data.otp,
            });

            // 2) If Clerk requires a new password, provide it
            if (attempt.status === "needs_new_password") {
                await signIn.resetPassword({ password: data.password });

                // Ensure no active session persists after reset so user can sign in again
                try {
                    await signOut();
                } catch { }

                toast.success("Password reset", { description: "Please sign in with your new password." });
                router.replace("/sign-in");
                return;
            }

            // Handle unexpected statuses
            toast.info("Additional steps required", { description: "Please retry the flow." });
            verifyForm.setError("root", { message: "Unexpected state. Please try again." });
        } catch (err: any) {
            const clerkError = err?.errors?.[0];
            const message = clerkError?.longMessage ?? "Unable to reset password";
            toast.error("Reset failed", { description: message });
        }
    }

    // Memoized handlers to prevent re-renders
    const handleOTPChange = useCallback((value: string) => {
        verifyForm.setValue("otp", value, {
            shouldValidate: true,
            shouldDirty: true
        });
    }, [verifyForm]);

    const handlePasswordChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        verifyForm.setValue("password", e.target.value, {
            shouldValidate: true,
            shouldDirty: true
        });
    }, [verifyForm]);

    const handleOTPBlur = useCallback(() => {
        verifyForm.trigger("otp");
    }, [verifyForm]);

    const handlePasswordBlur = useCallback(() => {
        verifyForm.trigger("password");
    }, [verifyForm]);

    return (
        <div className="w-full max-w-md mx-auto">
            <Card>
                <CardHeader className="text-center">
                    <CardTitle className="text-xl">Reset password</CardTitle>
                    <CardDescription>
                        {stage === "request"
                            ? "Enter your email to receive a reset code."
                            : "Enter the code and a new password."
                        }
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {stage === "request" ? (
                        <Form {...requestForm}>
                            <form onSubmit={requestForm.handleSubmit(onRequest)} className="space-y-4">
                                <FormField
                                    control={requestForm.control}
                                    name="email"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Email</FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="email"
                                                    placeholder="m@example.com"
                                                    autoComplete="email"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {requestForm.formState.errors.root && (
                                    <p className="text-center text-sm text-red-600">
                                        {requestForm.formState.errors.root.message}
                                    </p>
                                )}

                                {/* Clerk CAPTCHA element */}
                                <div id="clerk-captcha" />

                                <Button
                                    type="submit"
                                    disabled={requestForm.formState.isSubmitting || !requestForm.formState.isValid}
                                    className="w-full"
                                >
                                    {requestForm.formState.isSubmitting ? "Sending..." : "Send reset email"}
                                </Button>

                                <div className="text-center text-sm">
                                    <Link
                                        href="/sign-in"
                                        className="underline underline-offset-4 text-muted-foreground hover:text-primary"
                                    >
                                        Back to sign in
                                    </Link>
                                </div>
                            </form>
                        </Form>
                    ) : (
                        <Form {...verifyForm}>
                            <form onSubmit={verifyForm.handleSubmit(onVerify)} className="space-y-4">
                                {/* OTP Field */}
                                <div className="space-y-2">
                                    <FormLabel htmlFor="otp">Verification code</FormLabel>
                                    <InputOTP
                                        maxLength={6}
                                        value={verifyForm.watch("otp") || ""}
                                        onChange={handleOTPChange}
                                        onComplete={handleOTPBlur}
                                    >
                                        <InputOTPGroup>
                                            <InputOTPSlot index={0} />
                                            <InputOTPSlot index={1} />
                                            <InputOTPSlot index={2} />
                                            <InputOTPSlot index={3} />
                                            <InputOTPSlot index={4} />
                                            <InputOTPSlot index={5} />
                                        </InputOTPGroup>
                                    </InputOTP>
                                    {verifyForm.formState.errors.otp && (
                                        <p className="text-sm text-red-600">
                                            {verifyForm.formState.errors.otp.message}
                                        </p>
                                    )}
                                </div>

                                {/* Password Field */}
                                <div className="space-y-2">
                                    <FormLabel htmlFor="password">New password</FormLabel>
                                    <PasswordInput
                                        id="password"
                                        placeholder="••••••••"
                                        autoComplete="new-password"
                                        value={verifyForm.watch("password") || ""}
                                        onChange={handlePasswordChange}
                                        onBlur={handlePasswordBlur}
                                    />
                                    {verifyForm.formState.errors.password && (
                                        <p className="text-sm text-red-600">
                                            {verifyForm.formState.errors.password.message}
                                        </p>
                                    )}
                                </div>

                                {verifyForm.formState.errors.root && (
                                    <p className="text-center text-sm text-red-600">
                                        {verifyForm.formState.errors.root.message}
                                    </p>
                                )}

                                <Button
                                    type="submit"
                                    disabled={verifyForm.formState.isSubmitting || !verifyForm.formState.isValid}
                                    className="w-full"
                                >
                                    {verifyForm.formState.isSubmitting ? "Resetting..." : "Reset password"}
                                </Button>

                                <div className="text-center text-sm">
                                    <Button
                                        type="button"
                                        variant="link"
                                        onClick={() => {
                                            setStage("request");
                                            verifyForm.reset();
                                        }}
                                        className="underline underline-offset-4 text-muted-foreground hover:text-primary p-0"
                                    >
                                        Use a different email
                                    </Button>
                                </div>
                            </form>
                        </Form>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}