"use client";
import { useEffect, useRef, useState } from "react";

type ToastVariant = "default" | "destructive" | "success";

type ToastMessage = {
  id: number;
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
};

type Subscriber = (msg: Omit<ToastMessage, "id">) => void;

const subscribers = new Set<Subscriber>();
let idCounter = 1;

export const toast = (msg: Omit<ToastMessage, "id">) => {
  subscribers.forEach((cb) => cb(msg));
};

export function Toaster() {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const handler: Subscriber = (msg) => {
      if (!mounted.current) return;
      const id = idCounter++;
      const next: ToastMessage = {
        id,
        duration: 3500,
        variant: "default",
        ...msg,
      };
      setMessages((prev) => [...prev, next]);
      window.setTimeout(() => {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      }, next.duration);
    };
    subscribers.add(handler);
    return () => {
      mounted.current = false;
      subscribers.delete(handler);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex flex-col items-end gap-2 p-4">
      {messages.map((m) => (
        <div
          key={m.id}
          className={
            "pointer-events-auto w-full max-w-sm rounded border px-4 py-3 shadow-md bg-white text-gray-900 " +
            (m.variant === "destructive"
              ? "border-red-300"
              : m.variant === "success"
                ? "border-green-300"
                : "border-gray-200")
          }
          role="status"
          aria-live="polite"
        >
          {m.title ? <div className="font-medium">{m.title}</div> : null}
          {m.description ? (
            <div className="text-sm text-gray-700">{m.description}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
