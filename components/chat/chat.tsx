"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BranchNavigation } from "@/components/chat/branch-navigation";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import { usePlatformAccess } from "@/components/chat/platform-access";
import { ChatHeader } from "@/components/shell/chat-header";
import type { AppUsage } from "@/lib/ai/usage";
import { getChatErrorMessage } from "@/lib/ai/utils";
import type { TypeUIMessage } from "@/lib/types";
import type { ComposerSubmission } from "@/lib/ui/composer";

type Branch = { id: string; label: string; parentId: string | null };
type Run = { id: string; state: string; branchId: string };
export default function Chat({
  id,
  chatMessages,
  lastContext,
  title,
  initialBranchId = id,
  initialBranches = [],
  initialRuns = [],
}: {
  id: string;
  chatMessages: TypeUIMessage[];
  lastContext?: AppUsage;
  title?: string;
  initialBranchId?: string;
  initialBranches?: Branch[];
  initialRuns?: Run[];
}) {
  const [text, setText] = useState("");
  const [model, setModel] = useState("");
  const modelRef = useRef(model);
  const [branchId, setBranchId] = useState(initialBranchId);
  const branchRef = useRef(initialBranchId);
  const [branches, setBranches] = useState(initialBranches);
  const [runs, setRuns] = useState(initialRuns);
  const [syncing, setSyncing] = useState(false);
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const persisted = useRef(initialBranches.length > 0);
  const [localStopped, setLocalStopped] = useState(false);
  const access = usePlatformAccess();
  const refreshRef = useRef(access.refresh);
  refreshRef.current = access.refresh;
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    error,
    clearError,
  } = useChat<TypeUIMessage>({
    id,
    messages: chatMessages,
    experimental_throttle: 100,
    generateId: () => crypto.randomUUID(),
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: (async (input, init) => {
        const response = await fetch(input, init);
        const selected = response.headers.get("x-chat-branch");
        if (selected) {
          persisted.current = true;
          branchRef.current = selected;
          setBranchId(selected);
        }
        if (!response.ok) {
          const body = await response.json();
          throw new Error(body.error?.id ?? "chat_failed");
        }
        return response;
      }) as typeof fetch,
      prepareSendMessagesRequest: (request) => ({
        body: {
          id: request.id,
          message: request.messages.at(-1),
          model: modelRef.current,
          visibility: "private",
          webSearch: false,
          ...request.body,
        },
      }),
    }),
    onFinish: async () => {
      refreshRef.current();
      window.dispatchEvent(
        new CustomEvent("chat-created", { detail: { chatId: id } }),
      );
    },
    onError: (error) => {
      refreshRef.current();
      toast.error("Response failed", {
        description: getChatErrorMessage(error),
        closeButton: true,
      });
    },
  });
  const reload = useCallback(
    async (selected = branchRef.current) => {
      const changedBranch = selected !== branchRef.current;
      setSyncing(true);
      try {
        const response = await fetch(
          `/api/branches?chatId=${encodeURIComponent(id)}&branchId=${encodeURIComponent(selected)}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("history_unavailable");
        const view = await response.json();
        setBranches(view.branches);
        setRuns(view.runs);
        setMessages(view.messages);
        if (changedBranch) {
          clearError();
          setLocalStopped(false);
        }
        branchRef.current = view.branchId;
        setBranchId(view.branchId);
        window.history.replaceState(
          {},
          "",
          `/chat/${id}?branch=${encodeURIComponent(view.branchId)}`,
        );
      } catch {
        toast.error(
          "Could not reload saved conversation. Your current response remains visible.",
        );
      } finally {
        setSyncing(false);
      }
    },
    [id, setMessages, clearError],
  );
  useEffect(() => {
    modelRef.current = model;
  }, [model]);
  useEffect(() => {
    if (!access.models.some((m) => m.id === model && m.available))
      setModel(access.models.find((m) => m.available)?.id ?? "");
  }, [access.models, model]);
  const searchParams = useSearchParams();
  const query = searchParams.get("query");
  const queryRead = useRef(false);
  useEffect(() => {
    if (query && !queryRead.current) {
      queryRead.current = true;
      setText(query);
    }
  }, [query]);
  const busy = status === "submitted" || status === "streaming";
  function submit(
    draft: string,
    action: "send" | "edit" | "regenerate" | "retry" = "send",
    anchorId?: string,
  ): ComposerSubmission {
    if (
      inFlight.current ||
      busy ||
      syncing ||
      access.availability.state !== "ready"
    )
      return { accepted: false };
    inFlight.current = true;
    setSubmitting(true);
    setLocalStopped(false);
    const requestId = crypto.randomUUID();
    const message: TypeUIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: draft }],
    };
    if (action !== "send") {
      const index = messages.findIndex((m) => m.id === anchorId);
      const end =
        action === "edit"
          ? index
          : messages[index]?.role === "assistant"
            ? index - 1
            : index;
      setMessages(messages.slice(0, Math.max(0, end)));
    }
    const completion = (async () => {
      try {
        await sendMessage(message, {
          body: { requestId, branchId: branchRef.current, action, anchorId },
        });
      } finally {
        if (persisted.current) await reload();
        inFlight.current = false;
        setSubmitting(false);
        access.refresh();
      }
    })();
    return { accepted: true, completion };
  }
  function retry(action: "retry" | "regenerate") {
    const user = [...messages].reverse().find((m) => m.role === "user");
    if (user)
      submit(
        user.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n"),
        action,
        user.id,
      );
  }
  const currentRun = runs.filter((r) => r.branchId === branchId).at(-1);
  return (
    <div className="flex h-dvh min-h-0 min-w-0 flex-col bg-background">
      <ChatHeader
        title={title ?? "New conversation"}
        onNewChat={() => window.location.assign("/chat")}
      />
      <BranchNavigation
        branches={branches}
        branchId={branchId}
        busy={busy || submitting}
        syncing={syncing}
        state={localStopped ? "stopped" : currentRun?.state}
        onSelect={(selected) => void reload(selected)}
        onReload={() => void reload()}
        onRetry={() => retry("retry")}
        retryEnabled={access.availability.state === "ready"}
      />
      <ChatMessages
        key={id}
        messages={messages}
        setMessages={setMessages}
        status={status}
        error={error}
        regenerate={() => retry(error ? "retry" : "regenerate")}
        onEdit={async (messageId, draft) => {
          const submission = submit(draft, "edit", messageId);
          if (!submission.accepted) return false;
          await submission.completion;
          return true;
        }}
        actionsEnabled={
          access.availability.state === "ready" && !syncing && !submitting
        }
        onPrompt={(prompt) => {
          setText(prompt);
          document.getElementById("chat-composer")?.focus();
        }}
      />
      <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
        <ChatInput
          onSend={(draft) => submit(draft)}
          blocked={syncing || submitting}
          availability={access.availability}
          models={access.models}
          status={status}
          stop={() => {
            setLocalStopped(true);
            void stop();
            access.refresh();
          }}
          usage={lastContext}
          text={text}
          setText={setText}
          model={model}
          setModel={setModel}
        />
      </div>
    </div>
  );
}
