"use client"

import type { TypeSidebarUser } from "@/lib/types"
import { createContext, useContext } from "react"

export type ChatUserContextValue = TypeSidebarUser | null

const ChatUserContext = createContext<ChatUserContextValue>(null)

export function ChatUserProvider({ user, children }: { user?: TypeSidebarUser | null, children: React.ReactNode }) {
    return (
        <ChatUserContext.Provider value={user ?? null}>{children}</ChatUserContext.Provider>
    )
}

export function useChatUser() {
    return useContext(ChatUserContext)
}


