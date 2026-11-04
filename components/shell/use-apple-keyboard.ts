"use client";
import { useEffect, useState } from "react";

/** Whether shortcuts use ⌘ rather than Ctrl. Assumes Apple until mounted. */
export function useAppleKeyboard() {
  const [apple, setApple] = useState(true);
  useEffect(() => {
    setApple(/Mac|iPhone|iPad|iPod/.test(navigator.platform));
  }, []);
  return apple;
}
