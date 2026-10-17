"use client";
import { useState } from "react";
import { ChatMessages } from "@/components/chat/chat-messages";
import type { ArtifactDocument } from "@/lib/artifacts/contract";
import {
  type ArtifactClient,
  ConversationArtifacts,
} from "./artifact-workbench";

export const fixtureSource =
  "<!doctype html><h1>Launch notes</h1><p>A small document that stays with this conversation.</p><h2>Before sharing</h2><ul><li>Check the launch date</li><li>Confirm the owners</li><li>Download a copy</li></ul><script>parent.document.body.dataset.compromised='yes';fetch('https://artifact-network.invalid/script')</script><img src='https://artifact-network.invalid/image' onerror='alert(1)'><a href='https://artifact-network.invalid/link' target='_top'>External link is disabled</a><form action='https://artifact-network.invalid/form'><input type='submit'></form><iframe src='https://artifact-network.invalid/frame'></iframe><style>@import url(https://artifact-network.invalid/css);</style><meta http-equiv='refresh' content='0;url=https://artifact-network.invalid/navigation'>";
export function ArtifactFixture() {
  const [documents, setDocuments] = useState<ArtifactDocument[]>([]);
  const [revisions] = useState(new Map<string, ArtifactDocument[]>());
  const api: ArtifactClient = {
    list: async () => documents,
    read: async (id) => {
      const doc = documents.find((item) => item.id === id);
      if (!doc) throw new Error("not_found");
      return doc;
    },
    mutate: async (input) => {
      if (input.action === "create") {
        const id = crypto.randomUUID();
        const doc: ArtifactDocument = {
          id,
          chatId: "fixture-chat",
          messageId: "fixture-message",
          kind: input.kind,
          version: 1,
          title: input.title,
          content:
            input.kind === "html"
              ? fixtureSource
              : "# Launch notes\n\nA small document that stays with this conversation.\n\n- Check the launch date\n- Confirm the owners\n- Download a copy",
          updatedAt: new Date().toISOString(),
          revisions: [
            {
              version: 1,
              title: input.title,
              restoredFrom: null,
              createdAt: new Date().toISOString(),
            },
          ],
        };
        documents.push(doc);
        revisions.set(id, [doc]);
        setDocuments([...documents]);
        return { id };
      }
      const index = documents.findIndex((item) => item.id === input.id);
      const doc = documents[index];
      if (!doc) throw new Error("not_found");
      if (input.action === "delete") {
        documents.splice(index, 1);
        revisions.delete(input.id);
        setDocuments([...documents]);
        return { id: input.id, deleted: true };
      }
      if (input.expectedVersion !== doc.version)
        throw new Error("artifact_conflict");
      const original =
        input.action === "restore"
          ? revisions
              .get(doc.id)
              ?.find((item) => item.version === input.version)
          : input;
      if (!original) throw new Error("not_found");
      const version = doc.version + 1;
      const next = {
        ...doc,
        title: original.title,
        content: original.content,
        version,
        revisions: [
          {
            version,
            title: original.title,
            restoredFrom: input.action === "restore" ? input.version : null,
            createdAt: new Date().toISOString(),
          },
          ...doc.revisions,
        ],
      };
      documents[index] = next;
      revisions.get(doc.id)?.push(next);
      setDocuments([...documents]);
      return { id: doc.id };
    },
  };
  return (
    <main className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
        <div>
          <h1 className="font-semibold">Launch notes</h1>
          <p className="text-xs text-muted-foreground">
            Development fixture · In-memory artifacts · Downloads disabled
          </p>
        </div>
        <ConversationArtifacts chatId="fixture-chat" api={api} fixture />
      </header>
      <ChatMessages
        messages={[
          {
            id: "fixture-message",
            role: "assistant",
            parts: [
              {
                type: "text",
                text: "# Launch notes\n\nA small document that stays with this conversation.\n\n- Check the launch date\n- Confirm the owners\n- Download a copy",
              },
            ],
          },
        ]}
        status="ready"
        regenerate={() => {}}
        setMessages={() => {}}
      />
      <div className="mx-auto w-full max-w-3xl px-5 pb-8">
        <ConversationArtifacts
          chatId="fixture-chat"
          messageId="fixture-message"
          api={api}
          fixture
        />
      </div>
    </main>
  );
}
