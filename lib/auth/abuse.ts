import domains from "disposable-email-domains";

const blocked = new Set(domains);
export interface EmailProtection {
  limit(key: string): Promise<boolean>;
  verify(token: string): Promise<boolean>;
  hash(email: string): string;
}

/** Runs for every OTP request, including direct calls to the auth endpoint. */
export async function protectEmailCode(
  email: string,
  ip: string,
  token: string,
  protection: EmailProtection,
) {
  const normalized = email.trim().toLowerCase();
  if (blocked.has(normalized.split("@")[1] ?? ""))
    throw new Error("disposable_email");
  const results = await Promise.all([
    protection.limit(`ip:${ip}`),
    protection.limit(`email:${protection.hash(normalized)}`),
  ]);
  if (results.some((ok) => !ok)) throw new Error("rate_limited");
  if (!token || !(await protection.verify(token)))
    throw new Error("verification_failed");
}
