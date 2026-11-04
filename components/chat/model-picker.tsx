"use client";
import { Box, Check, ChevronDown, Lock } from "lucide-react";
import { useRef, useState } from "react";
import { ProviderIcon } from "@/components/icons/provider-icon";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { type CatalogModel, isCustomModelId, MODELS } from "@/lib/models";
import { cn } from "@/lib/utils";

const ITEM = "h-9 gap-2.5 rounded-lg px-2";
// Replaces the item's built-in check, so the mark at the end is ours.
const END_MARK = "tracking-normal";

function ModelRow({
  model,
  selected,
  locked,
  onSelect,
}: {
  model: CatalogModel;
  selected: boolean;
  locked: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={model.id}
      data-checked={selected ? "true" : undefined}
      className={ITEM}
      onSelect={onSelect}
    >
      <ProviderIcon
        provider={model.provider}
        className="text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate">{model.label}</span>
      {selected && (
        <CommandShortcut
          className={cn(
            END_MARK,
            "text-primary group-data-selected/command-item:text-primary",
          )}
        >
          <Check aria-hidden="true" className="size-4" />
        </CommandShortcut>
      )}
      {locked && !selected && (
        <CommandShortcut className={cn(END_MARK, "text-muted-foreground")}>
          <Lock aria-hidden="true" className="size-3.5" />
        </CommandShortcut>
      )}
    </CommandItem>
  );
}

export function ModelPicker({
  model,
  onChange,
  hasKey,
  addKey,
  disabled,
}: {
  model: string;
  onChange: (id: string) => void;
  hasKey: boolean;
  addKey: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const matches = MODELS.filter((m) =>
    `${m.provider} ${m.label} ${m.id}`.toLowerCase().includes(query),
  );
  // An OpenRouter ID that is not in the catalog; the server accepts it for
  // BYOK use only (resolveModel).
  const customId =
    isCustomModelId(search.trim()) &&
    !MODELS.some((m) => m.id === search.trim())
      ? search.trim()
      : null;
  const current = MODELS.find((m) => m.id === model);
  const close = () => {
    setOpen(false);
    setSearch("");
  };
  const row = (m: CatalogModel) => (
    <ModelRow
      key={m.id}
      model={m}
      selected={model === m.id}
      locked={!hasKey && !m.creditModel}
      onSelect={() => {
        close();
        if (!hasKey && !m.creditModel) addKey();
        else onChange(m.id);
      }}
    />
  );
  const credit = matches.filter((m) => m.creditModel);
  const other = matches.filter((m) => !m.creditModel);
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setSearch("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label="Choose model"
            className="h-8 min-w-0 shrink gap-1.5 rounded-full px-2.5"
          />
        }
      >
        <ProviderIcon
          provider={current?.provider ?? ""}
          className="text-muted-foreground"
        />
        <span className="max-w-40 truncate">{current?.label ?? model}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        // WebKit mobile doesn't restore focus implicitly after the exit transition.
        finalFocus={triggerRef}
        className="w-80 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
      >
        <Command shouldFilter={false} className="p-0">
          <CommandInput
            aria-label="Search models"
            placeholder={
              hasKey ? "Search or paste a model ID" : "Search models"
            }
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-[min(24rem,50dvh,calc(var(--available-height,100dvh)-3.5rem))] overscroll-contain p-1">
            <CommandEmpty>No models found.</CommandEmpty>
            {credit.length > 0 && (
              <CommandGroup heading="Credit models">
                {credit.map(row)}
              </CommandGroup>
            )}
            {other.length > 0 && (
              <CommandGroup heading="Your key">{other.map(row)}</CommandGroup>
            )}
            {customId && (
              <CommandGroup>
                <CommandItem
                  value={`custom:${customId}`}
                  className={cn(ITEM, !hasKey && "h-auto min-h-9 py-1.5")}
                  onSelect={() => {
                    close();
                    if (hasKey) onChange(customId);
                    else addKey();
                  }}
                >
                  <Box aria-hidden="true" className="text-muted-foreground" />
                  <span className="grid min-w-0 flex-1">
                    <span className="break-all">
                      {hasKey ? `Use ${customId}` : `Custom model ${customId}`}
                    </span>
                    {!hasKey && (
                      <span className="text-xs text-muted-foreground">
                        Add your OpenRouter key to use a custom model ID
                      </span>
                    )}
                  </span>
                  {!hasKey && (
                    <CommandShortcut
                      className={cn(END_MARK, "text-muted-foreground")}
                    >
                      <Lock aria-hidden="true" className="size-3.5" />
                    </CommandShortcut>
                  )}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
