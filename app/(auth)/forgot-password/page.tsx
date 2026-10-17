import Link from "next/link";

export default function ForgotPasswordPage() {
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-6">
      <h1 className="font-semibold text-xl">No password reset</h1>
      <p>Accounts use GitHub OAuth. There is no password to reset.</p>
      <Link href="/sign-in">Go to sign in</Link>
    </section>
  );
}
