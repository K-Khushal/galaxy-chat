"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { api, errorCopy } from "./api";
import { ByokDialog } from "./byok-dialog";
import { Composer } from "./composer";
import { ModelPicker } from "./model-picker";
export function NewChat() {
  const router = useRouter();
  const [model, setModel] = useState(DEFAULT_MODEL_ID);
  const [hasKey, setHasKey] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  useEffect(() => {
    api<{ key: unknown }>("/api/byok")
      .then((data) => setHasKey(!!data.key))
      .catch(() => {});
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="w-full max-w-3xl pb-[8vh]">
        <h1 className="mb-6 text-center text-3xl font-medium tracking-tight">
          What can I help with?
        </h1>
        {error && <p role="alert">{errorCopy(error)}</p>}
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
          busy={busy}
          onStop={() => {}}
          onSend={async (text) => {
            setBusy(true);
            try {
              const { chat } = await api<{ chat: { id: string } }>(
                "/api/chats",
                { model },
              );
              sessionStorage.setItem(`galaxy:send:${chat.id}`, text);
              window.dispatchEvent(new Event("galaxy:chats"));
              router.push(`/chat/${chat.id}`);
            } catch (error) {
              setError(error as Error);
              setBusy(false);
            }
          }}
        />
      </div>
      <ByokDialog
        open={keyOpen}
        onOpenChange={setKeyOpen}
        onSaved={() => setHasKey(true)}
      />
    </div>
  );
}
