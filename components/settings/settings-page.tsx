"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/chat/api";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/state";
import { ARCHIVED_PAGE } from "@/lib/chat/archived";
import { Account } from "./account";
import { type ArchivedChat, ArchivedChats } from "./archived-chats";
import { OpenRouterKey } from "./openrouter-key";
import { type Instructions, Personalization } from "./personalization";
import { SettingsFrame } from "./settings-group";
import { SettingsSkeleton } from "./settings-skeleton";
import { General } from "./theme-control";
import { Usage, type UsageReply } from "./usage";

export type { ArchivedChat };
export type Data = {
  settings: Instructions;
  credits: number;
  key: { updatedAt: string } | null;
  replies: UsageReply[];
};
type ArchivedPage = { chats: ArchivedChat[]; nextCursor: string | null };
const archivedUrl = (cursor?: string) =>
  `/api/chats?archived=true&limit=${ARCHIVED_PAGE}${
    cursor ? `&cursor=${cursor}` : ""
  }`;
const accountChanged = () =>
  window.dispatchEvent(new Event("galaxy-account-changed"));

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
  const [failed, setFailed] = useState(false);
  const hasInitial = initial !== undefined;

  const refresh = useCallback(async () => {
    const [settings, chats] = await Promise.all([
      api<Data>("/api/settings"),
      api<ArchivedPage>(archivedUrl()),
    ]);
    setData(settings);
    setArchived(chats.chats);
    setArchivedCursor(chats.nextCursor);
    accountChanged();
  }, []);
  const load = useCallback(() => {
    setFailed(false);
    void refresh().catch(() => setFailed(true));
  }, [refresh]);
  const refreshSettings = async () => {
    setData(await api<Data>("/api/settings"));
    accountChanged();
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
    if (!hasInitial) load();
  }, [hasInitial, load]);

  if (!data)
    return (
      <SettingsFrame>
        {failed ? (
          <ErrorState
            size="inline"
            title="Couldn't load Settings"
            description="Check your connection and try again."
            action={
              <Button variant="outline" size="sm" onClick={load}>
                Try again
              </Button>
            }
          />
        ) : (
          <SettingsSkeleton />
        )}
      </SettingsFrame>
    );
  return (
    <SettingsFrame>
      <General />
      <Personalization
        saved={data.settings}
        onSaved={(settings) =>
          setData((current) => current && { ...current, settings })
        }
      />
      <OpenRouterKey saved={data.key} onChanged={refreshSettings} />
      <Usage credits={data.credits} replies={data.replies} />
      <ArchivedChats
        chats={archived}
        hasMore={archivedCursor !== null}
        onRestored={removeArchived}
        onDeleted={removeArchived}
        onLoadMore={loadMore}
      />
      <Account />
    </SettingsFrame>
  );
}
