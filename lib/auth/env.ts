export type AuthConfig = {
  baseUrl: string;
  secret: string;
  githubClientId: string;
  githubClientSecret: string;
  databaseUrl: string;
  inviteLogins: string[];
};

export type EnvSource = Record<string, string | undefined>;

const REQUIRED_AUTH_KEYS = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "DATABASE_URL",
] as const;

export function parseInviteLogins(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  const logins: string[] = [];
  for (const part of value.split(",")) {
    const login = part.trim().toLowerCase();
    if (login.length > 0) {
      logins.push(login);
    }
  }
  return logins;
}

export function isInvitedLogin(
  login: string | null | undefined,
  allowlist: readonly string[],
): boolean {
  if (!login) {
    return false;
  }
  return allowlist.includes(login.trim().toLowerCase());
}

function present(env: EnvSource, key: (typeof REQUIRED_AUTH_KEYS)[number]) {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveAuthConfig(env: EnvSource): AuthConfig | null {
  for (const key of REQUIRED_AUTH_KEYS) {
    if (!present(env, key)) {
      return null;
    }
  }
  const secret = env.BETTER_AUTH_SECRET;
  const baseUrl = env.BETTER_AUTH_URL;
  const githubClientId = env.GITHUB_CLIENT_ID;
  const githubClientSecret = env.GITHUB_CLIENT_SECRET;
  const databaseUrl = env.DATABASE_URL;
  if (
    !secret ||
    !baseUrl ||
    !githubClientId ||
    !githubClientSecret ||
    !databaseUrl
  ) {
    return null;
  }
  if (secret.trim().length < 32) {
    return null;
  }
  return {
    baseUrl: baseUrl.trim(),
    secret: secret.trim(),
    githubClientId: githubClientId.trim(),
    githubClientSecret: githubClientSecret.trim(),
    databaseUrl: databaseUrl.trim(),
    inviteLogins: parseInviteLogins(env.GITHUB_INVITE_LOGINS),
  };
}

export function prototypeEnabled(env: EnvSource): boolean {
  return env.F01_PROTOTYPE === "1";
}
