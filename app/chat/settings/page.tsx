import { headers } from "next/headers";
import {
  type ArchivedChat,
  type Data,
  SettingsPage,
} from "@/components/settings/settings-page";
import { listChatsRoute } from "@/lib/api/chats";
import { appContext } from "@/lib/api/production";
import { getSettingsRoute } from "@/lib/api/settings";
import { ARCHIVED_PAGE } from "@/lib/chat/archived";

export default async function Page() {
  const requestHeaders = await headers();
  const ctx = await appContext();
  const [settings, chats] = await Promise.all([
    getSettingsRoute(
      ctx,
      new Request("http://localhost/api/settings", { headers: requestHeaders }),
    ),
    listChatsRoute(
      ctx,
      new Request(
        `http://localhost/api/chats?archived=true&limit=${ARCHIVED_PAGE}`,
        {
          headers: requestHeaders,
        },
      ),
    ),
  ]);
  // On any failure the page falls back to fetching, and reports the error itself.
  const initial =
    settings.ok && chats.ok
      ? {
          data: (await settings.json()) as Data,
          archived: (await chats.json()) as {
            chats: ArchivedChat[];
            nextCursor: string | null;
          },
        }
      : undefined;
  return <SettingsPage initial={initial} />;
}
