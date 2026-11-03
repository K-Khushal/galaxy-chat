// Springs for Motion components only; CSS uses the duration tokens in
// globals.css. Values from Fluid Functionalism, with bounce fixed at 0.
export const spring = {
  fast: { type: "spring", duration: 0.08, bounce: 0 },
  moderate: { type: "spring", duration: 0.16, bounce: 0 },
  slow: { type: "spring", duration: 0.24, bounce: 0 },
} as const;

// Exits are crisp tweens rather than the entrance played backwards.
export const exit = {
  fast: { duration: 0.06, ease: [0.23, 1, 0.32, 1] },
  moderate: { duration: 0.12, ease: [0.23, 1, 0.32, 1] },
  slow: { duration: 0.16, ease: [0.23, 1, 0.32, 1] },
} as const;
