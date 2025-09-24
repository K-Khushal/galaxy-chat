"use client";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/schema/auth/forgot-password";
import { useSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ForgotPasswordForm() {
    const router = useRouter();
    const { isLoaded, signIn } = useSignIn();

    const [form, setForm] = useState<ForgotPasswordInput>({ email: "" });
    const [error, setError] = useState<string>("");
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        const parsed = forgotPasswordSchema.safeParse(form);
        if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? "Invalid input");
            return;
        }
        if (!isLoaded) return;
        try {
            setLoading(true);
            await signIn.create({ strategy: "reset_password_email_code", identifier: form.email });
            setSent(true);
            toast({ variant: "success", title: "Reset email sent", description: "If the email exists, you'll receive a code." });
        } catch (err: any) {
            const msg = err?.errors?.[0]?.longMessage ?? "Unable to send reset code";
            setError(msg);
            toast({ variant: "destructive", title: "Request failed", description: msg });
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="w-full max-w-sm mx-auto">
            <h1 className="text-2xl font-semibold mb-4">Reset password</h1>
            {sent ? (
                <div className="space-y-3">
                    <p className="text-sm text-gray-700">We’ve sent a reset code to your email if it exists in our system.</p>
                    <Button onClick={() => router.push("/sign-in")} className="w-full">Back to sign in</Button>
                </div>
            ) : (
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
                    {error ? <p className="text-red-600 text-sm">{error}</p> : null}
                    <Button type="submit" disabled={loading} className="w-full">
                        {loading ? "Sending…" : "Send reset email"}
                    </Button>
                </form>
            )}
        </div>
    );
}


