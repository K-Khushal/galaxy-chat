"use client";

import { ArrowUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Static composer shell. It carries the final layout and states; sending,
 * attachments and autosize behaviour are wired up when chat lands.
 */
export function Composer() {
  return (
    <form
      aria-label="Message Galaxy"
      className="flex w-full flex-col gap-1 rounded-3xl border border-input bg-card p-2 shadow-xs transition-[border-color,box-shadow] duration-150 ease-out focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20"
      onSubmit={(event) => event.preventDefault()}
    >
      <label htmlFor="composer-input" className="sr-only">
        Message
      </label>
      <textarea
        id="composer-input"
        rows={1}
        placeholder="Message Galaxy"
        className="field-sizing-content max-h-48 min-h-10 w-full resize-none bg-transparent px-3 py-2 text-message outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label="Add attachment"
          disabled
        >
          <Plus />
        </Button>
        <Button
          type="submit"
          size="icon"
          className="rounded-full"
          aria-label="Send message"
          disabled
        >
          <ArrowUp />
        </Button>
      </div>
    </form>
  );
}
