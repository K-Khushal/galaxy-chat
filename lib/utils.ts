import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Stock tailwind-merge reads `text-caption` as a colour and drops it next to
// `text-muted-foreground`. Teach it the type roles from globals.css.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["display", "heading", "title", "caption", "message"] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
