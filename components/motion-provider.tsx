"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** Motion components honour the OS reduced-motion setting: transforms drop, fades stay. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
