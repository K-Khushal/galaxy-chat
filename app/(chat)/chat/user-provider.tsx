"use client"

import type { TypeSidebarUser } from "@/lib/types"
import { createContext, useContext } from "react"

type ChatUserContextValue = TypeSidebarUser | null

const ChatUserContext = createContext<ChatUserContextValue>(null)

export function ChatUserProvider({ user, children }: { user: ChatUserContextValue, children: React.ReactNode }) {
    return (
        <ChatUserContext.Provider value={user}>{children}</ChatUserContext.Provider>
    )
}

export function useChatUser() {
    return useContext(ChatUserContext)
}


