import { ensureDb } from "../../database/db";
import {
  type IUserProfile,
  UserProfileModel,
} from "../../database/models/user-profile";

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
      // Update the document if it exists
      $set: {
        name: params.name,
        imageUrl: params.imageUrl,
      },
      // Insert the document if it doesn't exist
      $setOnInsert: {
        userId: params.userId,
        email: params.email,
        name: params.name,
        imageUrl: params.imageUrl,
      },
    },
    {
      upsert: true,
      new: true,
      returnDocument: "after",
    },
  )
    .lean<UserProfile>()
    .exec();

  return result!;
}
