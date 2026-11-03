"use client";

import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps, toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";

const ERROR_DURATION = 6000;

// Sonner has no per-type duration, so errors get their longer default here,
// once, for every `toast.error` call in the app. A call's own `duration` wins.
const errorDefaults = Symbol.for("galaxy.toast.errorDefaults");
type PatchedToast = typeof toast & { [errorDefaults]?: true };
if (!(toast as PatchedToast)[errorDefaults]) {
  const error = toast.error;
  toast.error = (message, data) =>
    error(message, { duration: ERROR_DURATION, ...data });
  (toast as PatchedToast)[errorDefaults] = true;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Top centre never covers the composer.
      position="top-center"
      offset={16}
      visibleToasts={3}
      duration={4000}
      icons={{
        success: <CircleCheckIcon className="size-4 text-success" />,
        info: <InfoIcon className="size-4 text-muted-foreground" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" />,
        error: <CircleAlertIcon className="size-4 text-destructive" />,
        loading: <Spinner />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      toastOptions={{
        // Sonner's own styles are unlayered, so the L2 surface needs `!`.
        classNames: {
          toast: "cn-toast rounded-xl! shadow-lg! font-sans!",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
