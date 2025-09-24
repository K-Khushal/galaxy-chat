"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { VerifyEmailInput, VerifyEmailSchema } from "@/lib/schema/auth/verify-email";
import { useSignUp } from "@clerk/nextjs";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

type FormData = Pick<VerifyEmailInput, 'otp'>;

type VerifyEmailProps = {
    email: string;
    onSuccess?: () => void;
    onStartOver?: () => void;
};

export default function VerifyEmail({ email, onSuccess, onStartOver }: VerifyEmailProps) {
    const router = useRouter();
    const { isLoaded, signUp, setActive } = useSignUp();

    const form = useForm<FormData>({
        resolver: zodResolver(VerifyEmailSchema.pick({ otp: true })),
        mode: "onChange",
        defaultValues: {
            otp: "",
        },
    });

    async function retrySignUp(): Promise<boolean> {
        const storedEmail = localStorage.getItem('clerk-signup-email');
        const storedPassword = localStorage.getItem('clerk-signup-password');

        if (!storedEmail || !storedPassword) {
            toast.error("Session expired", {
                description: "Please start the sign-up process again."
            });
            return false;
        }

        try {
            if (!signUp) throw new Error("SignUp not available");
            await signUp.create({ emailAddress: storedEmail, password: storedPassword });
            await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
            toast.success("Session restored", {
                description: "Please try entering the verification code again."
            });
            return true;
        } catch (err: any) {
            toast.error("Failed to restore session", {
                description: "Please start the sign-up process again."
            });
            return false;
        }
    }

    function handleStartOver() {
        // Clear stored data
        localStorage.removeItem('clerk-signup-email');
        localStorage.removeItem('clerk-signup-password');

        toast.info("Starting over", {
            description: "Returning to sign-up form..."
        });

        // Reset parent component state
        onStartOver?.();
    }

    async function onSubmit(data: FormData) {
        if (!isLoaded || !signUp) {
            toast.error("System not ready", {
                description: "Please wait a moment and try again."
            });
            return;
        }

        // Double-check validation before proceeding
        const validation = VerifyEmailSchema.pick({ otp: true }).safeParse(data);
        if (!validation.success) {
            toast.error("Validation failed", {
                description: "Please enter a valid 6-digit code."
            });
            return;
        }

        try {
            const result = await signUp.attemptEmailAddressVerification({ code: data.otp });

            if (result.status === "complete") {
                // Clear stored data on success
                localStorage.removeItem('clerk-signup-email');
                localStorage.removeItem('clerk-signup-password');

                await setActive?.({ session: result.createdSessionId });

                toast.success("Email verified successfully!", {
                    description: "Welcome to Galaxy Chat! Redirecting..."
                });

                onSuccess?.();
                router.replace("/chat");
            } else {
                toast.error("Verification incomplete", {
                    description: "Please try again or contact support."
                });
            }
        } catch (err: any) {
            const errorMessage = err?.errors?.[0]?.longMessage ?? "Invalid verification code";

            if (errorMessage.includes("No sign up attempt was found") ||
                errorMessage.includes("GET request for this Client")) {
                toast.warning("Session expired", {
                    description: "Attempting to restore your session..."
                });

                const retrySuccess = await retrySignUp();
                if (!retrySuccess) {
                    form.setError("otp", {
                        message: "Session could not be restored. Please start over."
                    });
                }
            } else {
                toast.error("Verification failed", {
                    description: errorMessage
                });
                form.setError("otp", { message: errorMessage });
            }
        }
    }

    return (
        <Card className="w-full max-w-md">
            <CardHeader>
                <CardTitle>Verify your email</CardTitle>
                <CardDescription>Enter the 6-digit code sent to your email.</CardDescription>
            </CardHeader>
            <CardContent>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                                <Input value={email} disabled readOnly />
                            </FormControl>
                        </FormItem>

                        <FormField
                            control={form.control}
                            name="otp"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Verification Code</FormLabel>
                                    <FormControl>
                                        <InputOTP maxLength={6} {...field}>
                                            <InputOTPGroup>
                                                <InputOTPSlot index={0} />
                                                <InputOTPSlot index={1} />
                                                <InputOTPSlot index={2} />
                                                <InputOTPSlot index={3} />
                                                <InputOTPSlot index={4} />
                                                <InputOTPSlot index={5} />
                                            </InputOTPGroup>
                                        </InputOTP>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <Button
                            type="submit"
                            disabled={form.formState.isSubmitting || !form.formState.isValid}
                            className="w-full cursor-pointer"
                        >
                            {form.formState.isSubmitting ? "Verifying..." : "Verify Email"}
                        </Button>

                        <div className="text-center">
                            <Button
                                type="button"
                                variant="link"
                                onClick={handleStartOver}
                                className="text-sm cursor-pointer text-muted-foreground"
                            >
                                Start over
                            </Button>
                        </div>
                    </form>
                </Form>
            </CardContent>
        </Card>
    );
}


