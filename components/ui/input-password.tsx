"use client"

import { Input } from "@/components/ui/input"
import { EyeIcon, EyeOffIcon } from "lucide-react"
import { useState } from "react"

function PasswordInput({ className, type, ...props }: React.ComponentProps<"input">) {
    const [showPassword, setShowPassword] = useState(false)

    return (
        <div className="relative">
            <Input
                type={showPassword ? "text" : "password"}
                className={className}
                {...props}
            />
            <button
                className="text-muted-foreground/80 hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 absolute inset-y-0 end-0 flex h-full w-9 items-center justify-center rounded-e-md transition-[color,box-shadow] outline-none focus:z-10 focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                aria-controls="password"
            >
                {showPassword ? (
                    <EyeOffIcon size={16} aria-hidden="true" />
                ) : (
                    <EyeIcon size={16} aria-hidden="true" />
                )}
            </button>
        </div>
    )
}

export { PasswordInput }
