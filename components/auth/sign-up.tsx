"use client";
import GoogleIcon from "@/components/svg/google-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/input-password";
import { signUpSchema, type SignUpInput } from "@/lib/schema/auth/sign-up";
import { useSignUp } from "@clerk/nextjs";
import { zodResolver } from "@hookform/resolvers/zod";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

const VerifyEmail = dynamic(() => import("@/components/auth/verify-email"));

export default function SignUpForm() {
    const router = useRouter();
    const { isLoaded, signUp } = useSignUp();
    const [pendingVerification, setPendingVerification] = useState(false);
    const [userEmail, setUserEmail] = useState("");

    const form = useForm<SignUpInput>({
        resolver: zodResolver(signUpSchema),
        mode: "onChange",
        defaultValues: {
            email: "",
            password: "",
            confirmPassword: "",
        },
    });

    async function onSubmit(data: SignUpInput) {
        if (!isLoaded || !signUp) {
            toast.error("System not ready", {
                description: "Please wait a moment and try again."
            });
            return;
        }

        // Double-check validation before proceeding
        const validation = signUpSchema.safeParse(data);
        if (!validation.success) {
            toast.error("Validation failed", {
                description: "Please check your input and try again."
            });
            return;
        }

        try {
            await signUp.create({
                emailAddress: data.email,
                password: data.password
            });

            await signUp.prepareEmailAddressVerification({
                strategy: "email_code"
            });

            // Store sign-up data for session recovery
            localStorage.setItem('clerk-signup-email', data.email);
            localStorage.setItem('clerk-signup-password', data.password);

            setUserEmail(data.email);
            setPendingVerification(true);

            toast.success("Verification email sent!", {
                description: "Please check your inbox for the verification code."
            });
        } catch (err: any) {
            const errorMessage = err?.errors?.[0]?.longMessage ?? "Unable to create account";

            toast.error("Sign up failed", {
                description: errorMessage
            });

            form.setError("root", {
                message: errorMessage
            });
        }
    }

    return (
        <div className="w-full max-w-md mx-auto">
            {pendingVerification ? (
                <VerifyEmail
                    email={userEmail}
                    onSuccess={() => router.replace("/chat")}
                    onStartOver={() => {
                        setPendingVerification(false);
                        setUserEmail("");
                        form.reset();
                    }}
                />
            ) : (
                <Card>
                    <CardHeader className="text-center">
                        <CardTitle className="text-xl">Create your account</CardTitle>
                        <CardDescription>Enter your details to sign up.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-6">
                            <div className="flex flex-col gap-4">
                                <Button
                                    variant="outline"
                                    className="w-full"
                                    onClick={() => toast.info("Google sign-up", {
                                        description: "Google authentication will be implemented soon."
                                    })}
                                >
                                    <GoogleIcon className="size-4" />
                                    Sign up with Google
                                </Button>
                            </div>
                            <div className="after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
                                <span className="bg-card text-muted-foreground relative z-10 px-2">
                                    Or continue with
                                </span>
                            </div>

                            <Form {...form}>
                                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                                    <FormField
                                        control={form.control}
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

                                    <FormField
                                        control={form.control}
                                        name="password"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Password</FormLabel>
                                                <FormControl>
                                                    <PasswordInput
                                                        placeholder="••••••••"
                                                        autoComplete="new-password"
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="confirmPassword"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Confirm Password</FormLabel>
                                                <FormControl>
                                                    <PasswordInput
                                                        placeholder="••••••••"
                                                        autoComplete="new-password"
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {form.formState.errors.root && (
                                        <p className="text-center text-sm text-red-600">
                                            {form.formState.errors.root.message}
                                        </p>
                                    )}

                                    {/* Clerk CAPTCHA element */}
                                    <div id="clerk-captcha" />

                                    <Button
                                        type="submit"
                                        disabled={form.formState.isSubmitting || !form.formState.isValid}
                                        className="w-full cursor-pointer"
                                    >
                                        {form.formState.isSubmitting ? "Creating account..." : "Create account"}
                                    </Button>

                                    <div className="text-center text-sm">
                                        <Button
                                            type="button"
                                            variant="link"
                                            onClick={() => router.push("/sign-in")}
                                            className="underline underline-offset-4 cursor-pointer text-muted-foreground"
                                        >
                                            Already have an account? Sign in
                                        </Button>
                                    </div>
                                </form>
                            </Form>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}


