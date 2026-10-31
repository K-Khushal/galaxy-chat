import { expect, test } from "bun:test";
import { errorCopy, needsKey } from "../components/chat/api";

for (const code of [
  "cross_origin",
  "export_too_large",
  "reply_recovered",
  "no_credits",
  "needs_byok_key",
  "provider_key_rejected",
  "provider_payment_required",
  "payload_too_large",
  "rate_limited",
  "generation_active",
  "chat_not_found",
  "server_misconfigured",
]) {
  test(`actionable copy for ${code}, including transport JSON errors`, () => {
    const plain = new Error(code);
    const encoded = new Error(JSON.stringify({ error: code }));
    expect(errorCopy(plain)).not.toContain("Something went wrong");
    expect(errorCopy(encoded)).toBe(errorCopy(plain));
    expect(needsKey(encoded)).toBe(
      [
        "no_credits",
        "needs_byok_key",
        "provider_key_rejected",
        "provider_payment_required",
      ].includes(code),
    );
  });
}
test("generic errors have no key action or promise that unsent text is saved", () => {
  expect(needsKey(new Error("network"))).toBe(false);
  expect(errorCopy(new Error("network"))).toBe(
    "Something went wrong. Please try again.",
  );
  expect(errorCopy(new Error("payload_too_large"))).toContain("Shorten");
});
