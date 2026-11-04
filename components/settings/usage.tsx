"use client";
import { EmptyState } from "@/components/ui/state";
import { creditsLeft, formatCost } from "@/lib/credits/copy";
import { MODELS } from "@/lib/models";
import { SETTINGS_COPY } from "./copy";
import { LocalDate } from "./local-date";
import { SettingsGroup, SettingsList, SettingsRow } from "./settings-group";

export type UsageReply = {
  id: string;
  model: string;
  usage: {
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
  } | null;
  createdAt: string;
};

const tokensOf = (usage: UsageReply["usage"]) =>
  usage
    ? (usage.totalTokens ??
      (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))
    : null;

export function Usage({
  credits,
  replies,
}: {
  credits: number;
  replies: UsageReply[];
}) {
  return (
    <SettingsGroup title="Usage">
      <SettingsRow title={SETTINGS_COPY.credits}>
        <span className="text-sm tabular-nums">{creditsLeft(credits)}</span>
      </SettingsRow>
      {replies.length ? (
        <SettingsList
          // Keyboard users scroll it, and it has nothing else to focus.
          tabIndex={0}
          aria-label="Recent Replies"
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Recent Replies</caption>
            <thead className="text-xs font-medium text-muted-foreground">
              <tr>
                <th scope="col" className="sticky top-0 bg-card py-2 pl-4 pr-2">
                  Date
                </th>
                <th scope="col" className="sticky top-0 bg-card px-2 py-2">
                  Model
                </th>
                <th
                  scope="col"
                  className="sticky top-0 bg-card px-2 py-2 text-right"
                >
                  Tokens
                </th>
                <th
                  scope="col"
                  className="sticky top-0 bg-card py-2 pl-2 pr-4 text-right"
                >
                  Cost
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {replies.map((reply) => {
                const model = MODELS.find((m) => m.id === reply.model);
                const tokens = tokensOf(reply.usage);
                return (
                  <tr key={reply.id}>
                    <td className="py-2 pl-4 pr-2 whitespace-nowrap">
                      <LocalDate value={reply.createdAt} />
                    </td>
                    <td className="px-2 py-2">
                      {model ? (
                        model.label
                      ) : (
                        <span className="font-mono text-caption break-all">
                          {reply.model}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {tokens === null ? "—" : tokens.toLocaleString("en-US")}
                    </td>
                    <td className="py-2 pl-2 pr-4 text-right tabular-nums">
                      {reply.usage?.cost == null
                        ? "—"
                        : formatCost(reply.usage.cost)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </SettingsList>
      ) : (
        <SettingsList className="grid place-items-center px-4">
          <EmptyState size="inline" title="No Replies yet" />
        </SettingsList>
      )}
    </SettingsGroup>
  );
}
