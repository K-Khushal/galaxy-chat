"use client";
import { ChevronDown, Lock } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MODELS } from "@/lib/models";
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
  const [search, setSearch] = useState("");
  const matches = MODELS.filter((m) =>
    `${m.provider} ${m.label}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label="Choose model"
      >
        {MODELS.find((m) => m.id === model)?.label ?? model}
        <ChevronDown />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Choose a model</DialogTitle>
          <DialogDescription>
            Use Credits on selected models, or add your OpenRouter key.
          </DialogDescription>
          <Input
            aria-label="Search models"
            placeholder="Search models"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-[55dvh] overflow-y-auto">
            {[...new Set(matches.map((m) => m.provider))].map((provider) => (
              <section key={provider} className="mb-3">
                <h3 className="px-2 py-1 text-xs text-muted-foreground">
                  {provider}
                </h3>
                {matches
                  .filter((m) => m.provider === provider)
                  .map((m) => {
                    const locked = !hasKey && !m.creditModel;
                    return (
                      <button
                        type="button"
                        key={m.id}
                        aria-pressed={model === m.id}
                        className="flex w-full flex-col gap-1 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                          setOpen(false);
                          if (locked) addKey();
                          else onChange(m.id);
                        }}
                      >
                        <span className="flex w-full items-center justify-between">
                          {m.label}
                          {locked && <Lock className="size-3" />}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {[
                            m.capabilities.vision && "Vision",
                            m.capabilities.pdf && "PDF",
                            m.capabilities.reasoning && "Reasoning",
                            `${Math.round(m.capabilities.context / 1000)}k context`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {locked && (
                          <span className="text-xs text-muted-foreground">
                            Add your OpenRouter key
                          </span>
                        )}
                      </button>
                    );
                  })}
              </section>
            ))}
            {!matches.length && (
              <p className="p-2 text-muted-foreground">No models found.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
