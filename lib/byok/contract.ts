export const providers = ["openrouter", "gateway"] as const;
export type ByokProvider = (typeof providers)[number];
export type FundingChoice = "platform" | ByokProvider;
export type CredentialView = {
  provider: ByokProvider;
  maskedKey: string;
  revision: string;
  testState: "untested" | "valid" | "invalid" | "unavailable";
  testedAt: string | null;
};
export type ByokView = {
  configured: boolean;
  state: "available" | "disabled" | "busy" | "limited";
  credentials: CredentialView[];
};
export const BYOK_DISCLOSURE =
  "Messages go to your provider and model host. Your key authenticates the provider; you pay its charges. Platform credits are not used. Service limits apply.";
