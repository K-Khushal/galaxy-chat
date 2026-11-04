"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";

const options = [
  { value: "system", label: "System", icon: <Monitor /> },
  { value: "light", label: "Light", icon: <Sun /> },
  { value: "dark", label: "Dark", icon: <Moon /> },
];
const subscribe = () => () => {};

export function ThemeControl() {
  const { theme = "system", setTheme } = useTheme();
  // The stored theme is unknown on the server, so the control waits for the
  // client and a skeleton of the same size holds its place.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!mounted)
    return (
      <Skeleton aria-hidden="true" className="h-9 w-[16.3rem] rounded-lg" />
    );
  return (
    <SegmentedControl
      aria-label="Theme"
      value={theme}
      onValueChange={setTheme}
      options={options}
    />
  );
}
