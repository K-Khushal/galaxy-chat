import type { SidebarUser } from "@/lib/types";
import type { User } from "@clerk/nextjs/server";

export function toSidebarUser(user: User | null): SidebarUser | undefined {
    if (!user) return undefined;
    const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.username || undefined;
    const email = user.emailAddresses?.[0]?.emailAddress;
    return {
        id: user.id,
        name,
        email,
        imageUrl: user.imageUrl,
    };
}

export function toUserProfileInput(user: User | null): {
    userId: string;
    email?: string;
    name?: string;
    imageUrl?: string;
} | undefined {
    if (!user) return undefined;
    const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.username || undefined;
    const email = user.emailAddresses?.[0]?.emailAddress;
    return {
        userId: user.id,
        email,
        name,
        imageUrl: user.imageUrl,
    };
}


