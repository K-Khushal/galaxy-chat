export function canSendMessage(text: string, busy: boolean) {
  return text.trim().length > 0 && !busy;
}
export type ComposerSubmission =
  | { accepted: false }
  | { accepted: true; completion: Promise<void> };
/** Clearing a draft requires an explicit accepted claim, never a fulfilled no-op. */
export function acceptComposerSubmission({
  text,
  blocked,
  onSend,
  onAccepted,
}: {
  text: string;
  blocked: boolean;
  onSend: (text: string) => ComposerSubmission;
  onAccepted: () => void;
}): ComposerSubmission {
  if (!canSendMessage(text, blocked)) return { accepted: false };
  const submission = onSend(text.trim());
  if (submission.accepted) onAccepted();
  return submission;
}
