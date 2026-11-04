"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errorCopy } from "@/components/chat/api";
import { ByokDialog } from "@/components/chat/byok-dialog";
import { ThemeSwitcher } from "@/components/shell/theme-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth/client";
import { ARCHIVED_PAGE } from "@/lib/chat/archived";
import { creditsLeft } from "@/lib/credits/copy";

export type Data = {
  settings: { aboutYou: string; responseInstructions: string };
  credits: number;
  key: { updatedAt: string } | null;
  replies: {
    id: string;
    model: string;
    usage: {
      totalTokens?: number;
      inputTokens?: number;
      outputTokens?: number;
      cost?: number;
    } | null;
    createdAt: string;
  }[];
};
export type ArchivedChat = { id: string; title: string | null };
type ArchivedPage = { chats: ArchivedChat[]; nextCursor: string | null };
const archivedUrl = (cursor?: string) =>
  `/api/chats?archived=true&limit=${ARCHIVED_PAGE}${
    cursor ? `&cursor=${cursor}` : ""
  }`;

function LocalDate({ value }: { value: string }) {
  const [text, setText] = useState(value.slice(0, 10));
  useEffect(() => setText(new Date(value).toLocaleDateString()), [value]);
  return text;
}

export function SettingsPage({
  initial,
}: {
  initial?: { data: Data; archived: ArchivedPage };
}) {
  const [data, setData] = useState<Data | undefined>(initial?.data);
  const [archived, setArchived] = useState<ArchivedChat[]>(
    initial?.archived.chats ?? [],
  );
  const [archivedCursor, setArchivedCursor] = useState<string | null>(
    initial?.archived.nextCursor ?? null,
  );
  const hasInitial = initial !== undefined;
  const [keyOpen, setKeyOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    const [settings, chats] = await Promise.all([
      api<Data>("/api/settings"),
      api<ArchivedPage>(archivedUrl()),
    ]);
    setData(settings);
    setArchived(chats.chats);
    setArchivedCursor(chats.nextCursor);
    window.dispatchEvent(new Event("galaxy-account-changed"));
  }, []);
  const refreshSettings = async () => {
    setData(await api<Data>("/api/settings"));
    window.dispatchEvent(new Event("galaxy-account-changed"));
  };
  // The cursor marks the last loaded Chat, so dropping a restored or deleted
  // Chat locally keeps every loaded page and the cursor valid.
  async function removeArchived(id: string) {
    setArchived((current) => current.filter((chat) => chat.id !== id));
    await refreshSettings();
  }
  async function loadMore() {
    if (!archivedCursor) return;
    const next = await api<ArchivedPage>(archivedUrl(archivedCursor));
    setArchived((current) => [...current, ...next.chats]);
    setArchivedCursor(next.nextCursor);
  }
  useEffect(() => {
    if (hasInitial) return;
    void refresh().catch(() =>
      setNotice("Settings could not be loaded. Please try again."),
    );
  }, [refresh, hasInitial]);
  async function act(work: () => Promise<void>, message: string) {
    setBusy(true);
    setNotice("");
    try {
      await work();
      setNotice(message);
    } catch (error) {
      setNotice(errorCopy(error as Error));
    } finally {
      setBusy(false);
    }
  }
  const section = "grid gap-4 border-b border-border pb-8";
  return (
    <div className="overflow-y-auto">
      <div className="mx-auto grid w-full max-w-3xl gap-8 p-4 sm:p-8">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <output aria-live="polite">{notice}</output>
        {!data ? (
          notice ? (
            <Button onClick={() => void act(refresh, "Settings loaded.")}>
              Reload settings
            </Button>
          ) : (
            <div aria-hidden="true" className="grid gap-8">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-80 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )
        ) : (
          <>
            <section className={section}>
              <h2 className="text-lg font-medium">General</h2>
              <div className="flex items-center gap-3">
                Theme <ThemeSwitcher />
              </div>
            </section>
            <section className={section}>
              <h2 className="text-lg font-medium">Personalisation</h2>
              <p className="text-sm text-muted-foreground">
                Custom instructions apply to every Generation. Each field allows
                2,000 characters.
              </p>
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    await api("/api/settings", data.settings, "PUT");
                  }, "Custom instructions saved.");
                }}
              >
                <Label htmlFor="about-you">About you</Label>
                <Textarea
                  id="about-you"
                  maxLength={2000}
                  value={data.settings.aboutYou}
                  onChange={(e) =>
                    setData({
                      ...data,
                      settings: { ...data.settings, aboutYou: e.target.value },
                    })
                  }
                />
                <Label htmlFor="response-instructions">
                  How should Galaxy respond
                </Label>
                <Textarea
                  id="response-instructions"
                  maxLength={2000}
                  value={data.settings.responseInstructions}
                  onChange={(e) =>
                    setData({
                      ...data,
                      settings: {
                        ...data.settings,
                        responseInstructions: e.target.value,
                      },
                    })
                  }
                />
                <Button disabled={busy} type="submit">
                  Save instructions
                </Button>
              </form>
            </section>
            <section className={section}>
              <h2 className="text-lg font-medium">Models &amp; keys</h2>
              <p>
                {data.key ? (
                  <>
                    OpenRouter •••••••• · Saved{" "}
                    <LocalDate value={data.key.updatedAt} />
                  </>
                ) : (
                  "No OpenRouter key saved."
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setKeyOpen(true)}>
                  {data.key ? "Replace key" : "Add key"}
                </Button>
                {data.key && (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const result = await api<{ ok: boolean }>(
                            "/api/byok/test",
                            {},
                          );
                          if (!result.ok)
                            throw new Error("provider_key_rejected");
                        }, "Your key works.")
                      }
                    >
                      Test key
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api("/api/byok", {}, "DELETE");
                          await refreshSettings();
                        }, "Key removed.")
                      }
                    >
                      Remove key
                    </Button>
                  </>
                )}
              </div>
            </section>
            <section className={section}>
              <h2 className="text-lg font-medium">Usage</h2>
              <p>{creditsLeft(data.credits)}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="text-left text-muted-foreground">
                    Recent Replies (up to 50). Costs in USD when reported.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Model</th>
                      <th scope="col">Tokens</th>
                      <th scope="col">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.replies.map((reply) => (
                      <tr key={reply.id}>
                        <td className="py-2">
                          <LocalDate value={reply.createdAt} />
                        </td>
                        <td>{reply.model}</td>
                        <td>
                          {reply.usage?.totalTokens ??
                            (reply.usage
                              ? (reply.usage.inputTokens ?? 0) +
                                (reply.usage.outputTokens ?? 0)
                              : "—")}
                        </td>
                        <td>
                          {reply.usage?.cost == null
                            ? "—"
                            : `$${reply.usage.cost.toFixed(6)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.replies.length && <p>No Replies yet.</p>}
            </section>
            <section className={section}>
              <h2 className="text-lg font-medium">Data</h2>
              <h3>Archived chats</h3>
              {!archived.length && (
                <p className="text-sm text-muted-foreground">
                  No archived chats.
                </p>
              )}
              {archived.map((chat) => (
                <div
                  key={chat.id}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {chat.title ?? "Untitled chat"}
                  </span>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await api(
                          `/api/chats/${chat.id}`,
                          { archived: false },
                          "PATCH",
                        );
                        await removeArchived(chat.id);
                      }, "Chat restored.")
                    }
                  >
                    Unarchive
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await api(`/api/chats/${chat.id}`, {}, "DELETE");
                        await removeArchived(chat.id);
                      }, "Chat deleted.")
                    }
                  >
                    Delete
                  </Button>
                </div>
              ))}
              {archivedCursor && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void act(loadMore, "")}
                >
                  Load more
                </Button>
              )}
              <Button
                variant="link"
                render={
                  <a href="/api/account/export" download>
                    Export account as JSON
                  </a>
                }
              />
              <h3>Delete account</h3>
              <p className="text-sm text-muted-foreground">
                Permanently deletes your Chats, Messages, keys and settings. We
                keep hashed grant records to prevent repeat sign-up Credits.
              </p>
              <Label htmlFor="delete-confirmation">
                Type DELETE to confirm
              </Label>
              <Input
                id="delete-confirmation"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
              />
              <Button
                variant="destructive"
                disabled={busy || confirmation !== "DELETE"}
                onClick={() =>
                  void act(async () => {
                    await api("/api/account", { confirmation }, "DELETE");
                    try {
                      await authClient.signOut();
                    } finally {
                      window.location.assign("/sign-in");
                    }
                  }, "Account deleted.")
                }
              >
                Delete account permanently
              </Button>
            </section>
          </>
        )}
        <ByokDialog
          open={keyOpen}
          onOpenChange={setKeyOpen}
          onSaved={() => void refresh()}
        />
      </div>
    </div>
  );
}
