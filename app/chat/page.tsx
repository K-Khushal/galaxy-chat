import { getOrCreateUserProfile } from "@/lib/actions/auth/user";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
    const { userId } = await auth();
    if (!userId) {
        redirect("/sign-in");
    }

    const user = await currentUser();
    const profile = await getOrCreateUserProfile({
        userId,
        email: user?.emailAddresses?.[0]?.emailAddress,
        name: `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || user?.username || undefined,
        imageUrl: user?.imageUrl,
    });

    return (
        <main className="max-w-4xl mx-auto p-6 space-y-6">
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <section className="rounded-lg border p-4 space-y-2">
                <h2 className="text-lg font-medium">Clerk User</h2>
                <div className="text-sm text-gray-600">ID: {userId}</div>
                {user?.emailAddresses?.[0]?.emailAddress ? (
                    <div className="text-sm">Email: {user.emailAddresses[0].emailAddress}</div>
                ) : null}
            </section>
            <section className="rounded-lg border p-4 space-y-2">
                <h2 className="text-lg font-medium">MongoDB Profile</h2>
                <div className="text-sm">Name: {profile.name ?? "-"}</div>
                <div className="text-sm">Preferences: {JSON.stringify(profile.preferences ?? {}, null, 2)}</div>
            </section>
        </main>
    );
}


