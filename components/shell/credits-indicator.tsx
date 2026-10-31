"use client";
import { useEffect, useState } from "react";
export function CreditsIndicator() {
  const [data, setData] = useState<{ credits: number; key: unknown }>();
  useEffect(() => {
    const refresh = () => {
      void fetch("/api/credits")
        .then((r) => (r.ok ? r.json() : null))
        .then((value) => {
          if (value) setData(value);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("galaxy-account-changed", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("galaxy-account-changed", refresh);
    };
  }, []);
  if (!data) return null;
  return <CreditsStatus data={data} />;
}

export function CreditsStatus({
  data,
}: {
  data: { credits: number; key: unknown };
}) {
  return (
    <p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
      {data.credits === 0 && data.key
        ? "Using your key"
        : `${data.credits} Credits left`}
      {data.credits <= 2 && !data.key && (
        <span className="block">Add your key to keep chatting.</span>
      )}
    </p>
  );
}
