import { StartConversationButton } from "@/components/chat/start-conversation-button";
// Auth redirect is already enforced by middleware and layout

export default async function ChatHomePage() {
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


