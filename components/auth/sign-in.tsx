"use client";

import GoogleIcon from "@/components/svg/google-icon";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/input-password";
import { type SignInInput, signInSchema } from "@/lib/schema/auth/sign-in";
import { useSignIn } from "@clerk/nextjs";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

export default function SignInForm() {
  const router = useRouter();
  const { isLoaded, signIn, setActive } = useSignIn();

  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    mode: "onChange",
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(data: SignInInput) {
    if (!isLoaded || !signIn) {
      toast.error("System not ready", {
        description: "Please wait a moment and try again.",
      });
      return;
    }

    const normalized = {
      email: data.email.trim().toLowerCase(),
      password: data.password,
    } as SignInInput;

    const validation = signInSchema.safeParse(normalized);
    if (!validation.success) {
      toast.error("Validation failed", {
        description: "Please check your input and try again.",
      });
      return;
    }

    try {
      const result = await signIn.create({
        identifier: normalized.email,
        password: normalized.password,
      });

      if (result.status === "complete") {
        await setActive?.({ session: result.createdSessionId });
        toast.success("Signed in", {
          description: "Welcome back!",
          closeButton: true,
        });
        router.replace("/chat");
        return;
      }

      // Handle cases like MFA or further steps generically
      toast.info("Additional steps required", {
        description: "Please follow the on-screen instructions and try again.",
      });

      form.setError("root", {
        message: "Additional steps required. Please try again.",
      });
    } catch (err: any) {
      const clerkError = err?.errors?.[0];
      const message = clerkError?.longMessage ?? "Unable to sign in";

      if (
        typeof message === "string" &&
        message.toLowerCase().includes("already signed in")
      ) {
        toast.success("Already signed in", {
          description: "Redirecting to chat...",
        });
        router.replace("/chat");
        return;
      }

      toast.error("Sign in failed", { description: message });
    }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Welcome back</CardTitle>
          <CardDescription>Enter your credentials to sign in.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6">
            <div className="flex flex-col gap-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() =>
                  toast.info("Google sign-in", {
                    description:
                      "Google authentication will be implemented soon.",
                  })
                }
              >
                <GoogleIcon className="size-4" />
                Sign in with Google
              </Button>
            </div>

            <div className="after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
              <span className="bg-card text-muted-foreground relative z-10 px-2">
                Or continue with
              </span>
            </div>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
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
                          autoComplete="current-password"
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
                  disabled={
                    form.formState.isSubmitting || !form.formState.isValid
                  }
                  className="w-full cursor-pointer"
                >
                  {form.formState.isSubmitting ? "Signing in..." : "Sign in"}
                </Button>

                <div className="flex items-center justify-between text-sm">
                  <Link
                    href="/sign-up"
                    className="underline underline-offset-4 cursor-pointer text-muted-foreground"
                  >
                    Create account
                  </Link>
                  <Link
                    href="/forgot-password"
                    className="underline underline-offset-4 cursor-pointer text-muted-foreground"
                  >
                    Forgot password?
                  </Link>
                </div>
              </form>
            </Form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
