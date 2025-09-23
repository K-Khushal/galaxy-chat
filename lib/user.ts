import { getDb } from "./mongodb";

export type UserProfile = {
    userId: string; // Clerk user id
    email?: string;
    name?: string;
    imageUrl?: string;
    preferences?: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
};

export async function getOrCreateUserProfile(params: {
    userId: string;
    email?: string;
    name?: string;
    imageUrl?: string;
}): Promise<UserProfile> {
    const db = await getDb();
    const collection = db.collection<UserProfile>("user_profiles");

    const existing = await collection.findOne({ userId: params.userId });
    if (existing) return existing;

    const profile: UserProfile = {
        userId: params.userId,
        email: params.email,
        name: params.name,
        imageUrl: params.imageUrl,
        preferences: {},
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    await collection.insertOne(profile as any);
    return profile;
}

export async function updateUserPreferences(userId: string, preferences: Record<string, unknown>) {
    const db = await getDb();
    const collection = db.collection<UserProfile>("user_profiles");
    await collection.updateOne(
        { userId },
        { $set: { preferences, updatedAt: new Date() } },
        { upsert: true },
    );
}


