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

    const result = await UserProfileModel.findOneAndUpdate(
        { userId: params.userId },
        {
            $setOnInsert: {
                userId: params.userId,
                email: params.email,
                name: params.name,
                imageUrl: params.imageUrl,
                preferences: {}
            }
        },
        {
            upsert: true,
            new: true,
            returnDocument: 'after'
        }
    ).lean<UserProfile>().exec();

    return result!;
}

export async function updateUserPreferences(userId: string, preferences: Record<string, unknown>) {
    await ensureDb();
    await UserProfileModel.updateOne(
        { userId },
        { $set: { preferences } },
        { upsert: true },
    ).exec();
}


