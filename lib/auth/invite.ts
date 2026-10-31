export function isInvitedLogin(
  login: string | null | undefined,
  allowlist: readonly string[],
): boolean {
  if (!login) {
    return false;
  }
  return allowlist.includes(login.trim().toLowerCase());
}
