import type { Metadata } from "next";
import { HalaskaElementsPrototype } from "@/components/spike/halaska-elements-prototype";

export const metadata: Metadata = {
  title: "F01 compatibility prototype",
  description:
    "Local Halaska and AI Elements prototype. It does not call a model provider.",
};

export default function F01PrototypePage() {
  return <HalaskaElementsPrototype />;
}
