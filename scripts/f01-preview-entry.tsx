import { createRoot } from "react-dom/client";
import { HalaskaElementsPrototype } from "../components/spike/halaska-elements-prototype";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<HalaskaElementsPrototype />);
}
