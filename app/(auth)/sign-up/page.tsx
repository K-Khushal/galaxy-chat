import Link from "next/link";

export default function SignUpPage() {
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-6">
      <h1 className="font-semibold text-xl">GitHub sign-in only</h1>
      <p>Email sign-up is not available. Invited GitHub accounts sign in.</p>
      <Link href="/sign-in">Go to sign in</Link>
    </section>
  );
}
