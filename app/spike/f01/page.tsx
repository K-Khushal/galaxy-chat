import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HalaskaElementsPrototype } from "@/components/spike/halaska-elements-prototype";
import { prototypeEnabled } from "@/lib/auth/env";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  if (!prototypeEnabled(process.env)) {
    return { title: "Not found" };
  }
  return {
    title: "F01 compatibility prototype",
    description:
      "Local Halaska and AI Elements prototype. It does not call a model provider.",
  };
}

export default function F01PrototypePage() {
  if (!prototypeEnabled(process.env)) {
    notFound();
  }
  return <HalaskaElementsPrototype />;
}
