import type { TypeSidebarUser } from "@/lib/types";
import type { User } from "@clerk/nextjs/server";

export function getDisplayName(user: User): string | undefined {
    const first = user.firstName ?? "";
    const last = user.lastName ?? "";
    const full = `${first} ${last}`.trim();
    const name = full.length > 0 ? full : (user.username || undefined);
    return name === "" ? undefined : name;
}

export function toSidebarUser(user: User | null): TypeSidebarUser | undefined {
    if (!user) return undefined;
    const name = getDisplayName(user);
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
    const name = getDisplayName(user);
    const email = user.emailAddresses?.[0]?.emailAddress;
    return {
        userId: user.id,
        email,
        name,
        imageUrl: user.imageUrl,
    };
}


