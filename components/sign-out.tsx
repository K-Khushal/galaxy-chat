"use client"

import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { useClerk } from "@clerk/nextjs"
import { LogOut } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useState } from "react"
import { toast } from "sonner"

export default function SignOut() {
    const { signOut } = useClerk()
    const router = useRouter()
    const [isSigningOut, setIsSigningOut] = useState(false)

    const handleSignOut = useCallback(async () => {
        if (isSigningOut) return
        setIsSigningOut(true)
        try {
            await signOut({ redirectUrl: "/" })
            // Fallback in case redirect is blocked
            router.replace("/")
        } catch (error: any) {
            const message = error?.errors?.[0]?.longMessage ?? "Unable to sign out"
            toast.error("Sign out failed", { description: message })
        } finally {
            setIsSigningOut(false)
        }
    }, [isSigningOut, signOut, router])

    return (
        <DropdownMenuItem
            className="cursor-pointer"
            disabled={isSigningOut}
            onSelect={(e) => {
                e.preventDefault()
                void handleSignOut()
            }}
        >
            <LogOut />
            {isSigningOut ? "Signing out..." : "Log out"}
        </DropdownMenuItem>
    )
}