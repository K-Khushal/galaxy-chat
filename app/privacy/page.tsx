export default function Privacy() {
  return (
    <main className="mx-auto max-w-prose space-y-6 px-6 py-16">
      <h1 className="text-3xl font-semibold">Privacy</h1>
      <p>
        Galaxy stores your account details and sign-in sessions to provide
        access to your Chats. Authentication uses GitHub, Google, Resend for
        email delivery, Upstash for temporary verification and rate limits, and
        Cloudflare Turnstile for abuse prevention.
      </p>
      <p>
        After account deletion, we keep a keyed, hashed grant record of verified
        emails and GitHub or Google account IDs that received sign-up Credits.
        This prevents repeated grants. The record contains no raw email or
        provider ID and survives account deletion.
      </p>
      <p>
        Do not include sensitive information in Chats. Contact the operator to
        request account deletion or ask about your data.
      </p>
    </main>
  );
}
