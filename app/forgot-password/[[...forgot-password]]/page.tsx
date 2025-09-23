"use client";
import { ResetPassword } from "@clerk/nextjs";

export default function ForgotPasswordPage() {
    return (
        <div className="min-h-[80vh] w-full flex items-center justify-center p-4">
            <ResetPassword signInUrl="/sign-in" />
        </div>
    );
}


