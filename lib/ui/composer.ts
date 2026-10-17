export function canSendMessage(text: string, busy: boolean) {
  return text.trim().length > 0 && !busy;
}
