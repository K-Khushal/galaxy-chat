"use client";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { preloadResponse } from "@/components/elements/preload-response";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/state";
import { DEFAULT_MODEL_ID, findModel } from "@/lib/models";
import { api, errorCopy, needsKey } from "./api";
import { ByokDialog } from "./byok-dialog";
import { Composer } from "./composer";
import { ModelPicker } from "./model-picker";
import { useByokKey } from "./use-byok-key";
import { useCredits } from "./use-credits";

/** The empty-Chat page, shared with its loading skeleton so nothing jumps. */
export function NewChatLayout({
  alert,
  children,
}: {
  alert?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="w-full max-w-3xl pb-[8vh]">
        <h1 className="mb-6 text-center text-display font-semibold">
          What can I help with?
        </h1>
        {alert && <div className="mb-3">{alert}</div>}
        {children}
      </div>
    </div>
  );
}

export function NewChat() {
  const router = useRouter();
  useEffect(() => {
    // Whoever starts typing is about to read a Reply, so fetch the renderer now.
    document.addEventListener("focusin", preloadResponse, { once: true });
    return () => document.removeEventListener("focusin", preloadResponse);
  }, []);
  const [model, setModel] = useState(DEFAULT_MODEL_ID);
  const { hasKey, setHasKey } = useByokKey();
  const account = useCredits();
  const [keyOpen, setKeyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  return (
    <NewChatLayout
      alert={
        error && (
          <InlineAlert
            action={
              needsKey(error) ? (
                <Button size="sm" onClick={() => setKeyOpen(true)}>
                  Add your OpenRouter key
                </Button>
              ) : undefined
            }
          >
            {errorCopy(error)}
          </InlineAlert>
        )
      }
    >
      <Composer
        picker={
          <ModelPicker
            model={model}
            onChange={setModel}
            hasKey={hasKey}
            addKey={() => setKeyOpen(true)}
            disabled={busy}
          />
        }
        chatId="new"
        model={model}
        busy={busy}
        onStop={() => {}}
        onSend={async (text, files) => {
          // Nothing can pay for this Message, so don't leave an empty Chat behind.
          if (
            account.credits === 0 &&
            account.hasKey === false &&
            findModel(model)?.creditModel
          ) {
            setError(new Error("no_credits"));
            return false;
          }
          setBusy(true);
          setError(undefined);
          try {
            const { chat } = await api<{ chat: { id: string } }>("/api/chats", {
              model,
            });
            sessionStorage.setItem(`galaxy:send:${chat.id}`, text);
            if (files.length > 0) {
              sessionStorage.setItem(
                `galaxy:attach:${chat.id}`,
                JSON.stringify(files),
              );
            }
            window.dispatchEvent(new Event("galaxy:chats"));
            router.push(`/chat/${chat.id}`);
            return false; // Retain the new-Chat draft until its first send is accepted.
          } catch (error) {
            setError(error as Error);
            setBusy(false);
            return false;
          }
        }}
      />
      <ByokDialog
        open={keyOpen}
        onOpenChange={setKeyOpen}
        onSaved={() => {
          setHasKey(true);
          setError(undefined);
        }}
      />
    </NewChatLayout>
  );
}
