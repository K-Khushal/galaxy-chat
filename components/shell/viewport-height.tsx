"use client";
import { useEffect } from "react";

/**
 * Publishes the visible height as `--app-height` so the chat shell ends at the
 * on-screen keyboard. Browsers that resize the layout (Chrome with
 * `interactiveWidget: resizes-content`) already agree with `100dvh`; iOS Safari
 * only shrinks the visual viewport and pans the page, so it needs this.
 */
export function ViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const update = () => {
      // Pinch-zoom also shrinks the visual viewport; leave the layout alone then.
      if (viewport.scale !== 1) root.style.removeProperty("--app-height");
      else root.style.setProperty("--app-height", `${viewport.height}px`);
      // The shell is exactly one viewport tall, so undo the browser's pan.
      if (viewport.scale === 1 && viewport.offsetTop > 0) window.scrollTo(0, 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      root.style.removeProperty("--app-height");
    };
  }, []);
  return null;
}
