"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const themes = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

export function ThemeControl() {
  const { setTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = mounted ? (theme ?? "system") : "system";

  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm">Theme</legend>
      <div className="flex flex-wrap gap-1">
        {themes.map((option) => (
          <button
            aria-pressed={current === option.id}
            className="min-h-11 rounded-md border border-border px-3 py-2 text-sm aria-pressed:bg-primary aria-pressed:text-primary-foreground"
            key={option.id}
            onClick={() => setTheme(option.id)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
