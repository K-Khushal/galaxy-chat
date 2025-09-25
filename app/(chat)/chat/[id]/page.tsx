export default function ConversationPage({ params }: { params: { id: string } }) {
    return (
        <main className="max-w-2xl mx-auto p-6 space-y-6">
            <h1 className="text-2xl font-semibold">Conversation</h1>
            <p className="text-sm text-muted-foreground">ID: {params.id}</p>
            <div className="rounded-md border p-4">This is where messages will appear.</div>
        </main>
    );
}


