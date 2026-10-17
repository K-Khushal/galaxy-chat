export function scrollBehavior(reducedMotion: boolean): ScrollBehavior {
  if (reducedMotion) {
    return "auto";
  }
  return "smooth";
}

export function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
