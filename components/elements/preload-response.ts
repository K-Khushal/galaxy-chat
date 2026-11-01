/**
 * Starts fetching the Reply renderer (see reply-markdown.tsx) before the first Reply
 * needs it. Kept apart from it so importing this does not pull in its styles.
 */
export function preloadResponse() {
  void import("streamdown");
  void import("./reply-markdown");
}
