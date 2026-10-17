"use client";
import { Check, ChevronDown, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatModel } from "@/lib/ai/model";
import {
  type ChatAvailability,
  defaultAvailability,
} from "@/lib/ui/availability";
export function ModelSelector({
  value,
  onValueChange,
  models = [],
  availability = defaultAvailability,
}: {
  value: string;
  onValueChange: (value: string) => void;
  models?: ChatModel[];
  availability?: ChatAvailability;
}) {
  const selected = models.find((model) => model.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="max-w-full gap-2 px-2 text-muted-foreground"
          aria-label="Choose model"
        >
          <Cpu aria-hidden="true" />
          <span className="truncate">{selected?.name ?? "Choose model"}</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-72 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuLabel>Model access</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {models.length > 0 ? (
          models.map((model) => (
            <DropdownMenuItem
              disabled={availability.state !== "ready" || !model.available}
              key={model.id}
              onSelect={() => onValueChange(model.id)}
            >
              <div className="min-w-0 flex-1">
                <p>{model.name}</p>
                {model.description && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {model.description}
                  </p>
                )}
              </div>
              {model.id === value && <Check />}
            </DropdownMenuItem>
          ))
        ) : (
          <p className="px-2 py-3 text-sm leading-relaxed text-muted-foreground">
            Models will appear when a provider is connected. No model requests
            are enabled yet.
          </p>
        )}
        {availability.state === "unavailable" && models.length > 0 && (
          <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">
            {availability.reason}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
