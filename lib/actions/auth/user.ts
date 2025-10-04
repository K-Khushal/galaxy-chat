import type { TypeUserProfile } from "@/lib/types";
import { ensureDb } from "../../database/db";
import {
  type IUserProfile,
  UserProfileModel,
} from "../../database/models/user-profile";

export type UserProfile = IUserProfile;

export async function createUser(
  params: TypeUserProfile,
): Promise<UserProfile> {
  await ensureDb();

  const userProfile = new UserProfileModel({
    userId: params.userId,
    email: params.email,
    name: params.name,
    imageUrl: params.imageUrl,
  });

  const result = await userProfile.save();
  return result.toObject();
}

export async function getUser(userId: string): Promise<UserProfile | null> {
  await ensureDb();

  const result = await UserProfileModel.findOne({ userId })
    .lean<UserProfile>()
    .exec();

  return result;
}

export async function updateUser(
  userId: string,
  updates: Partial<Omit<TypeUserProfile, "userId">>,
): Promise<UserProfile> {
  await ensureDb();

  const result = await UserProfileModel.findOneAndUpdate(
    { userId: userId },
    { $set: updates },
    { new: true, returnDocument: "after" },
  )
    .lean<UserProfile>()
    .exec();

  if (!result) {
    throw new Error("User not found");
  }

  return result;
}

export async function deleteUser(userId: string): Promise<void> {
  await ensureDb();

  const result = await UserProfileModel.findOneAndDelete({
    userId: userId,
  }).exec();

  if (!result) {
    throw new Error("User not found");
  }
}

// Keep the original function for backward compatibility
export async function getOrCreateUserProfile(
  params: TypeUserProfile,
): Promise<UserProfile> {
  const existingUser = await getUser(params.userId);

  if (existingUser) {
    return existingUser;
  }

  return await createUser(params);
}
