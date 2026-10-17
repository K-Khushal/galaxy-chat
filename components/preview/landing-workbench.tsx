"use client";

import { useState } from "react";
import { ThemeControl } from "@/components/shell/theme-control";
import { Button } from "@/components/ui/button";

const pages = [
  { path: "/", label: "Home" },
  { path: "/help", label: "Help" },
  { path: "/privacy", label: "Privacy & data" },
  { path: "/preview/artifacts", label: "Local artifacts fixture" },
  { path: "/guest", label: "Guest (public)" },
  { path: "/preview/ui?context=1", label: "Local memory & projects fixture" },
  {
    path: "/preview/ui?guest=available",
    label: "Local guest fixture: available",
  },
  {
    path: "/preview/ui?guest=streaming",
    label: "Local guest fixture: streaming",
  },
  {
    path: "/preview/ui?guest=botpending",
    label: "Local guest fixture: botpending",
  },
  {
    path: "/preview/ui?guest=exhausted",
    label: "Local guest fixture: exhausted",
  },
];
const widths = ["390", "768", "1280", "Fit"];

export function LandingWorkbench() {
  const [page, setPage] = useState("/");
  const [width, setWidth] = useState("390");

  return (
    <div className="flex h-dvh flex-col bg-muted">
      <header className="shrink-0 border-b bg-card p-3">
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <h1 className="text-sm font-semibold">Galaxy landing preview</h1>
          <p className="text-xs text-muted-foreground">
            Development only. Local guest fixtures make no provider requests.
            Public pages, sign-in and chat retain their normal checks.
          </p>
          <a
            className="ml-auto inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
            href={page}
            target="_blank"
            rel="noreferrer"
          >
            Open page
          </a>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex min-w-0 flex-col gap-2 text-sm">
            Page
            <select
              className="min-h-11 rounded-md border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
              value={page}
              onChange={(event) => setPage(event.target.value)}
            >
              {pages.map(({ path, label }) => (
                <option key={path} value={path}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend className="mb-2 text-sm">Viewport width</legend>
            <div className="flex flex-wrap gap-1">
              {widths.map((value) => (
                <Button
                  key={value}
                  type="button"
                  aria-pressed={width === value}
                  variant={width === value ? "secondary" : "outline"}
                  onClick={() => setWidth(value)}
                >
                  {value}
                </Button>
              ))}
            </div>
          </fieldset>
          <ThemeControl />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <iframe
          key={page}
          src={page}
          title="Galaxy public page responsive canvas"
          className="mx-auto block h-full border-x border-border bg-background"
          style={{
            width: width === "Fit" ? "100%" : `${width}px`,
            minHeight: "320px",
          }}
        />
      </div>
    </div>
  );
}
