"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errorCopy } from "@/components/chat/api";
import { ByokDialog } from "@/components/chat/byok-dialog";
import { ThemeSwitcher } from "@/components/shell/theme-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth/client";

type Data = {
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
export function SettingsPage() {
  const [data, setData] = useState<Data>();
  const [archived, setArchived] = useState<
    { id: string; title: string | null }[]
  >([]);
  const [keyOpen, setKeyOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    const [settings, chats] = await Promise.all([
      api<Data>("/api/settings"),
      api<{ chats: typeof archived }>("/api/chats?archived=true"),
    ]);
    setData(settings);
    setArchived(chats.chats);
    window.dispatchEvent(new Event("galaxy-account-changed"));
  }, []);
  useEffect(() => {
    void refresh().catch(() =>
      setNotice("Settings could not be loaded. Please try again."),
    );
  }, [refresh]);
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
          <Button onClick={() => void act(refresh, "Settings loaded.")}>
            Reload settings
          </Button>
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
                <label htmlFor="about-you">About you</label>
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
                <label htmlFor="response-instructions">
                  How should Galaxy respond
                </label>
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
                {data.key
                  ? `OpenRouter •••••••• · Saved ${new Date(data.key.updatedAt).toLocaleDateString()}`
                  : "No OpenRouter key saved."}
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
                          await refresh();
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
              <p>{data.credits} credits left</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="text-left text-muted-foreground">
                    Recent Replies (up to 50). Costs in USD when reported.
                  </caption>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Model</th>
                      <th>Tokens</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.replies.map((reply) => (
                      <tr key={reply.id}>
                        <td className="py-2">
                          {new Date(reply.createdAt).toLocaleDateString()}
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
                        await refresh();
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
                        await refresh();
                      }, "Chat deleted.")
                    }
                  >
                    Delete
                  </Button>
                </div>
              ))}
              <a className="underline" href="/api/account/export" download>
                Export account as JSON
              </a>
              <h3>Delete account</h3>
              <p className="text-sm text-muted-foreground">
                Permanently deletes your Chats, Messages, keys and settings. We
                keep hashed grant records to prevent repeat sign-up Credits.
              </p>
              <label htmlFor="delete-confirmation">
                Type DELETE to confirm
              </label>
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
                    await authClient.signOut();
                    window.location.assign("/sign-in");
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
