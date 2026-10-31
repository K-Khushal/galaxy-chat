"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
export function useByokKey() {
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => {
    api<{ key: unknown }>("/api/byok")
      .then((data) => setHasKey(!!data.key))
      .catch(() => {});
  }, []);
  return { hasKey, setHasKey };
}
