import { StartConversationButton } from "@/components/chat/start-conversation-button";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function ChatHomePage() {
    const { userId } = await auth();
    if (!userId) {
        redirect("/sign-in");
    }

    return (
        <main className="max-w-2xl mx-auto p-6 space-y-6">
            <h1 className="text-2xl font-semibold">Chat</h1>
            <p className="text-sm text-muted-foreground">
                Start a new conversation to get an id-based chat URL.
            </p>
            <StartConversationButton />
        </main>
    );
}


