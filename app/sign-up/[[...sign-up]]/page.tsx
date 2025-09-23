"use client";
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
    return (
        <div className="min-h-[80vh] w-full flex items-center justify-center p-4">
            <SignUp signInUrl="/sign-in" />
        </div>
    );
}


