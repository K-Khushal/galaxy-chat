"use client";
import type { ChatStatus } from "ai";
import { ExternalLink, Monitor, Smartphone } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  type AccountActions,
  SettingsDialog,
} from "@/components/account-settings";
import { SignInPanel } from "@/components/auth/sign-in";
import { BranchNavigation } from "@/components/chat/branch-navigation";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ChatHeader } from "@/components/shell/chat-header";
import { ChatLoading } from "@/components/shell/chat-loading";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { TypeUIMessage } from "@/lib/types";
import type { CreditStatus } from "@/lib/ui/credits";
import {
  fixtureHistory,
  fixtureMessages,
  longMessages,
  type PreviewScenario,
  previewScenarios,
  previewUser,
} from "@/lib/ui/preview-fixtures";

export function PreviewWorkbench() {
  const [width, setWidth] = useState("fluid");
  const [scenario, setScenario] = useState("empty");
  const [theme, setTheme] = useState("system");
  const [dialog, setDialog] = useState("");
  const [credit, setCredit] = useState("unavailable");
  const source = `/preview/ui?${new URLSearchParams({ canvas: "1", state: scenario, theme, dialog, credit })}`;
  const selectClass =
    "min-h-11 min-w-0 rounded-md border bg-background px-2 text-base md:text-sm";
  return (
    <div className="flex h-dvh flex-col bg-muted">
      <header className="shrink-0 border-b bg-card p-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-sm font-semibold">Galaxy · UI preview</h1>
          <p className="text-xs text-muted-foreground">
            Local fixtures only. No auth, database, or provider requests.
          </p>
          <a
            className="ml-auto flex min-h-11 items-center gap-2 text-sm underline"
            href={source}
            target="_blank"
            rel="noreferrer"
          >
            Open canvas
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 text-xs">
            State
            <select
              className={selectClass}
              value={scenario}
              onChange={(event) => setScenario(event.target.value)}
            >
              {previewScenarios.map((state) => (
                <option key={state}>{state}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            Theme
            <select
              className={selectClass}
              value={theme}
              onChange={(event) => setTheme(event.target.value)}
            >
              {["system", "light", "dark"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            Dialog
            <select
              className={selectClass}
              value={dialog}
              onChange={(event) => setDialog(event.target.value)}
            >
              <option value="">Closed</option>
              <option value="profile">Account</option>
              <option value="appearance">Appearance</option>
              <option value="security">Privacy</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            Credit fixture
            <select
              className={selectClass}
              value={credit}
              onChange={(event) => setCredit(event.target.value)}
            >
              {["unavailable", "available", "exhausted", "paused", "byok"].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
          </label>
          <div className="flex gap-1">
            <Button
              variant={width === "390" ? "secondary" : "outline"}
              onClick={() => setWidth("390")}
            >
              <Smartphone />
              390
            </Button>
            <Button
              variant={width === "1280" ? "secondary" : "outline"}
              onClick={() => setWidth("1280")}
            >
              <Monitor />
              1280
            </Button>
            <Button
              variant={width === "fluid" ? "secondary" : "outline"}
              onClick={() => setWidth("fluid")}
            >
              Fit
            </Button>
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <iframe
          key={source}
          src={source}
          title="Galaxy UI preview canvas"
          className="mx-auto block h-full border-x border-border bg-background"
          style={{
            width: width === "fluid" ? "100%" : `${width}px`,
            minHeight: "480px",
          }}
        />
      </div>
    </div>
  );
}

export function PreviewCanvas({
  scenario,
  theme,
  dialog,
  credit,
}: {
  scenario: PreviewScenario;
  theme: string;
  dialog?: string;
  credit?: string;
}) {
  const { setTheme } = useTheme();
  useEffect(() => setTheme(theme), [setTheme, theme]);
  const [chats, setChats] = useState(fixtureHistory);
  const [activeId, setActiveId] = useState("fixture-0");
  const [messages, setMessages] = useState<TypeUIMessage[]>(
    scenario === "long"
      ? longMessages
      : ["populated", "branches", "streaming", "error"].includes(scenario)
        ? fixtureMessages
        : [],
  );
  const [fixtureBranchId, setFixtureBranchId] = useState("original");
  const [fixtureBranches, setFixtureBranches] = useState([
    {
      id: "original",
      label: "Original",
      parentId: null as string | null,
      messages: fixtureMessages,
    },
  ]);
  async function forkFixture(anchorId?: string, draft?: string) {
    const index = messages.findIndex((message) => message.id === anchorId);
    const end =
      draft !== undefined
        ? index
        : messages.findLastIndex((message) => message.role === "user");
    const originalUser = messages[Math.max(0, end)];
    const id = crypto.randomUUID();
    const next: TypeUIMessage[] = [
      ...messages.slice(0, Math.max(0, end)),
      {
        id: crypto.randomUUID(),
        role: "user",
        parts:
          draft !== undefined
            ? [{ type: "text", text: draft }]
            : originalUser.parts,
      },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "This is a local branch fixture. No provider was called. The original remains in the branch selector.",
          },
        ],
      },
    ];
    setFixtureBranches((items) => [
      ...items,
      {
        id,
        label: draft !== undefined ? "Edited prompt" : "Regenerated",
        parentId: fixtureBranchId,
        messages: next,
      },
    ]);
    setFixtureBranchId(id);
    setMessages(next);
    document.getElementById("chat-composer")?.focus();
    return true;
  }
  const [text, setText] = useState("");
  const [model, setModel] = useState("fixture-text");
  const [settings, setSettings] = useState(Boolean(dialog));
  const [status, setStatus] = useState<ChatStatus>(
    scenario === "streaming"
      ? "streaming"
      : scenario === "error"
        ? "error"
        : "ready",
  );
  const creditStatus: CreditStatus =
    credit === "available"
      ? {
          state: "available",
          remainingMicrodollars: 350000,
          resetsAt: "2026-10-18T00:00:00Z",
        }
      : credit === "exhausted"
        ? { state: "exhausted", resetsAt: "2026-10-18T00:00:00Z" }
        : credit === "paused"
          ? { state: "paused", reason: "Fixture: shared funding is paused." }
          : credit === "byok"
            ? { state: "byok" }
            : { state: "unavailable", reason: "metering_pending" };
  const accountActions: AccountActions = {
    exportData: () => {
      toast.info("Preview export: no account data was requested.");
    },
    deleteAccount: () => {
      setChats([]);
      setMessages([]);
      toast.info("Preview account cleared. Reload to restore fixtures.");
    },
    signOut: () => {
      toast.info("Preview sign-out: no session exists.");
    },
  };
  const newChat = () => {
    setActiveId("");
    setMessages([]);
    setStatus("ready");
    setText("");
  };
  return (
    <div data-ui-preview className="flex h-dvh min-w-0 flex-col">
      <div className="shrink-0 border-b border-border bg-accent px-3 py-1.5 text-center text-[11px] font-medium text-accent-foreground">
        UI PREVIEW · Static fixtures · No requests are sent
      </div>
      {scenario === "sign-in" || scenario === "unconfigured" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-10">
          <SignInPanel
            configured={scenario === "sign-in"}
            notice={
              scenario === "unconfigured" ? "auth_unconfigured" : undefined
            }
            onSignIn={() =>
              toast.info("Preview sign-in: OAuth was not called.")
            }
          />
        </div>
      ) : (
        <SidebarProvider
          className="min-h-0 flex-1"
          style={{ height: "calc(100dvh - 29px)" }}
        >
          <AppSidebar
            user={previewUser}
            onNewChat={newChat}
            creditStatus={creditStatus}
            accountActions={accountActions}
            preview={{
              pages: [
                { chats: chats.slice(0, 15), hasMore: chats.length > 15 },
                { chats: chats.slice(15), hasMore: false },
              ],
              activeId,
              loading: scenario === "history-loading",
              error: scenario === "history-error",
              onSelect: (id) => {
                setActiveId(id);
                setMessages(fixtureMessages);
                setStatus("ready");
              },
              onDelete: (id) => {
                setChats((items) => items.filter((item) => item.id !== id));
                if (id === activeId) newChat();
              },
              onRename: (id, title) =>
                setChats((items) =>
                  items.map((item) =>
                    item.id === id ? { ...item, title } : item,
                  ),
                ),
            }}
          />
          <SidebarInset className="min-h-0 overflow-hidden [&>div]:h-full">
            {scenario === "loading" ? (
              <ChatLoading />
            ) : (
              <div className="flex min-h-0 min-w-0 flex-col">
                <ChatHeader
                  title={
                    messages.length
                      ? (chats.find((chat) => chat.id === activeId)?.title ??
                        "Preview conversation")
                      : "New conversation"
                  }
                  onNewChat={newChat}
                />
                {scenario === "branches" && (
                  <BranchNavigation
                    branches={fixtureBranches}
                    branchId={fixtureBranchId}
                    busy={false}
                    syncing={false}
                    onSelect={(id) => {
                      setFixtureBranchId(id);
                      setMessages(
                        fixtureBranches.find((branch) => branch.id === id)
                          ?.messages ?? [],
                      );
                    }}
                    onReload={() =>
                      setMessages(
                        fixtureBranches.find(
                          (branch) => branch.id === fixtureBranchId,
                        )?.messages ?? [],
                      )
                    }
                    onRetry={() => void forkFixture()}
                    retryEnabled={true}
                  />
                )}
                <ChatMessages
                  key={activeId}
                  messages={messages}
                  setMessages={setMessages}
                  status={status}
                  error={
                    scenario === "error"
                      ? new Error(
                          "Fixture: the provider is temporarily unavailable. Your message is preserved.",
                        )
                      : undefined
                  }
                  actionsEnabled={scenario === "branches"}
                  onEdit={
                    scenario === "branches"
                      ? (id, draft) => forkFixture(id, draft)
                      : undefined
                  }
                  regenerate={() =>
                    scenario === "branches"
                      ? void forkFixture()
                      : toast.info("Preview retry: no model was called.")
                  }
                  onPrompt={(prompt) => {
                    setText(prompt);
                    document.getElementById("chat-composer")?.focus();
                  }}
                />
                <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
                  <ChatInput
                    text={text}
                    setText={setText}
                    model={model}
                    setModel={setModel}
                    models={[
                      {
                        id: "fixture-text",
                        name: "Fixture text model",
                        available: true,
                        description:
                          "Local UI example. No provider is connected.",
                      },
                    ]}
                    availability={
                      credit === "available" || credit === "byok"
                        ? {
                            state: "ready",
                            funding: credit === "byok" ? "byok" : "platform",
                          }
                        : {
                            state: "unavailable",
                            reason:
                              "Preview: generation is paused. Choose an available credit fixture to test composing.",
                          }
                    }
                    status={status}
                    stop={() => {
                      setStatus("ready");
                      toast.info("Preview response stopped.");
                    }}
                    onSend={(draft) => {
                      setMessages((items) => [
                        ...items,
                        {
                          id: `local-${Date.now()}`,
                          role: "user",
                          parts: [{ type: "text", text: draft }],
                        },
                      ]);
                      toast.info(
                        "Draft added to this preview. No response will be generated.",
                      );
                      return { accepted: true, completion: Promise.resolve() };
                    }}
                  />
                </div>
              </div>
            )}
          </SidebarInset>
        </SidebarProvider>
      )}
      <SettingsDialog
        open={settings}
        setOpen={setSettings}
        user={previewUser}
        actions={accountActions}
        initialTab={dialog}
      />
    </div>
  );
}
