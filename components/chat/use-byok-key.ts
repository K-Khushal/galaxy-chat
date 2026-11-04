"use client";
import { useState } from "react";
import { useCredits } from "./use-credits";

/** Whether a BYOK key is saved; `setHasKey` reflects a save before the refetch lands. */
export function useByokKey() {
  const { hasKey: fetched } = useCredits();
  const [saved, setSaved] = useState<boolean>();
  return { hasKey: saved ?? fetched ?? false, setHasKey: setSaved };
}
