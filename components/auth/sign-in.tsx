"use client";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { signInSchema, type SignInInput } from "@/lib/schema/auth/sign-in";
import { useAuth, useSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignInForm() {
    const router = useRouter();
    const { isLoaded, signIn, setActive } = useSignIn();
    const { isSignedIn } = useAuth();

    const [form, setForm] = useState<SignInInput>({ email: "", password: "" });
    const [error, setError] = useState<string>("");
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        const parsed = signInSchema.safeParse(form);
        if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? "Invalid input");
            return;
        }
        if (!isLoaded) return;
        try {
            setLoading(true);
            const result = await signIn.create({ identifier: form.email, password: form.password });
            if (result.status === "complete") {
                await setActive?.({ session: result.createdSessionId });
                toast({ variant: "success", title: "Signed in", description: "Welcome back!" });
                router.replace("/chat");
            } else {
                const msg = "Additional steps required. Please try again.";
                setError(msg);
                toast({ variant: "destructive", title: "Sign in incomplete", description: msg });
            }
        } catch (err: any) {
            const msg = err?.errors?.[0]?.longMessage ?? "Unable to sign in";
            setError(msg);
            toast({ variant: "destructive", title: "Sign in failed", description: msg });
        } finally {
            setLoading(false);
        }
    }

    if (isSignedIn) {
        router.replace("/chat");
        return null;
    }

    return (
        <div className="w-full max-w-sm mx-auto">
            <h1 className="text-2xl font-semibold mb-4">Sign in</h1>
            <form onSubmit={handleSubmit} className="space-y-3">
                <input
                    type="email"
                    placeholder="Email"
                    className="w-full border rounded px-3 py-2"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    autoComplete="email"
                    required
                />
                <input
                    type="password"
                    placeholder="Password"
                    className="w-full border rounded px-3 py-2"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    autoComplete="current-password"
                    required
                />
                {error ? <p className="text-red-600 text-sm">{error}</p> : null}
                {/* Clerk CAPTCHA element */}
                <div id="clerk-captcha" />
                <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Signing in…" : "Sign in"}
                </Button>
                <div className="text-sm flex justify-between">
                    <a href="/sign-up" className="underline">
                        Create account
                    </a>
                    <a href="/forgot-password" className="underline">
                        Forgot password?
                    </a>
                </div>
            </form>
        </div>
    );
}


