"use client";
import { useEffect, useState } from "react";

/** Server and first client render show the UTC date, then the local one. */
export function LocalDate({
  value,
  format,
}: {
  value: string;
  format?: Intl.DateTimeFormatOptions;
}) {
  const [text, setText] = useState(value.slice(0, 10));
  useEffect(
    () => setText(new Date(value).toLocaleDateString(undefined, format)),
    [value, format],
  );
  return text;
}
