import { ensureDb } from "../../database/db";
import { UserProfileModel, type IUserProfile } from "../../database/models/UserProfile";

export type UserProfile = IUserProfile;

export async function getOrCreateUserProfile(params: {
    userId: string;
    email?: string;
    name?: string;
    imageUrl?: string;
}): Promise<UserProfile> {
    await ensureDb();
    const existing = await UserProfileModel.findOne({ userId: params.userId }).lean<UserProfile>().exec();
    if (existing) return existing;

    const created = await UserProfileModel.create({
        userId: params.userId,
        email: params.email,
        name: params.name,
        imageUrl: params.imageUrl,
        preferences: {},
    });
    return created.toObject();
}

export async function updateUserPreferences(userId: string, preferences: Record<string, unknown>) {
    await ensureDb();
    await UserProfileModel.updateOne(
        { userId },
        { $set: { preferences } },
        { upsert: true },
    ).exec();
}


